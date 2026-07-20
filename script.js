const sampleTranscript = [
  { channel: "external", time: "10:25 AM", text: "Hi, I'm trying to find out why my last transfer is still pending." },
  { channel: "internal", time: "10:25 AM", text: "I can help with that. Let me take a quick look at the transfer details for you." },
  { channel: "external", time: "10:26 AM", text: "Thank you. It was sent yesterday afternoon." },
  { channel: "internal", time: "10:27 AM", text: "I see it here. It's processing normally and should be complete by the end of today." },
  { channel: "external", time: "10:28 AM", text: "Perfect, that's all I needed to know." }
];

const transcript = document.querySelector("#transcript");
const messageCount = document.querySelector("#message-count");
const demoButton = document.querySelector("#add-demo-message");
const intentPanel = document.querySelector("#intent-panel");
const intentName = document.querySelector("#intent-name");
const intentDetail = document.querySelector("#intent-detail");
const intentAction = document.querySelector("#intent-action");
const summaryPanel = document.querySelector("#summary-panel");
const summaryText = document.querySelector("#summary-text");
const summaryLike = document.querySelector("#summary-like");
const connectionStatus = document.querySelector("#connection-status");
const connectionLabel = document.querySelector("#connection-label");

const url = new URL(window.location.href);
const genesysConfig = {
  region: normalizeRegion(url.searchParams.get("gc_region") || sessionStorage.getItem("gc_region")),
  clientId: url.searchParams.get("gc_clientId") || sessionStorage.getItem("gc_clientId"),
  redirectUrl: url.searchParams.get("gc_redirectUrl") || sessionStorage.getItem("gc_redirectUrl") || `${window.location.origin}${window.location.pathname}`
};
const transcriptsByConversation = new Map();
const subscribedTopics = new Set();
let activeConversationId = null;
let notificationApi;
let usersApi;
let apiClient;
let notificationSocket;
let notificationChannelId;

function normalizeRegion(region) {
  return String(region || "").trim().replace(/^https?:\/\//i, "").replace(/^login\./i, "").replace(/\/.*$/, "");
}

function setConnectionState(state, label) {
  connectionStatus.className = `connection-status ${state}`;
  connectionLabel.textContent = label;
}

function isAgentChannel(channel) {
  return /internal|agent|advisor|employee/i.test(String(channel || ""));
}

function renderTranscriptEntries(entries) {
  transcript.replaceChildren();
  entries.forEach((entry) => transcript.append(createMessage(entry)));
  messageCount.textContent = `${entries.length} ${entries.length === 1 ? "message" : "messages"}`;
  transcript.scrollTop = transcript.scrollHeight;
}

function createMessage(entry) {
  const isAgent = isAgentChannel(entry.channel);
  const message = document.createElement("article");
  message.className = `message ${isAgent ? "agent" : "customer"}${entry.isFinal === false ? " is-partial" : ""}`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = isAgent ? "AG" : "CU";

  const content = document.createElement("div");
  content.className = "message-content";
  const meta = document.createElement("div");
  meta.className = "message-meta";
  const speaker = document.createElement("span");
  speaker.className = "speaker";
  speaker.textContent = isAgent ? "Agent" : "Customer";
  const time = document.createElement("time");
  time.textContent = entry.time || new Date(entry.receivedAt || Date.now()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  meta.append(speaker, time);
  const bubble = document.createElement("p");
  bubble.className = "bubble";
  bubble.textContent = entry.text;
  content.append(meta, bubble);
  message.append(avatar, content);
  return message;
}

function renderIntentRecommendation(intent) {
  intentName.textContent = intent.name || "Customer intent";
  intentDetail.textContent = intent.detail || "A customer need was detected during the conversation.";
  intentAction.textContent = intent.action || "Create follow-up task";
  intentAction.disabled = false;
  intentPanel.hidden = false;
  intentAction.classList.remove("flash");
  void intentAction.offsetWidth;
  intentAction.classList.add("flash");
}

function renderConversationSummary(summary) {
  if (!summary) return;
  summaryText.textContent = summary;
  summaryPanel.hidden = false;
}

function getTranscriptChannelLabel(channel) {
  if (typeof channel === "string") return channel;
  if (Array.isArray(channel?.enum)) return channel.enum.join(", ");
  return String(channel || "Unknown");
}

function extractTranscriptEntries(eventBody) {
  if (!Array.isArray(eventBody?.transcripts)) return [];
  return eventBody.transcripts.map((transcriptEntry) => {
    const alternative = transcriptEntry?.alternatives?.[0];
    const text = alternative?.decoratedTranscript || alternative?.transcript;
    if (!text) return null;
    return {
      utteranceId: transcriptEntry.utteranceId || `${getTranscriptChannelLabel(transcriptEntry.channel)}-${alternative?.offsetMs || 0}`,
      text: String(text).replace(/\s+/g, " ").trim(),
      channel: getTranscriptChannelLabel(transcriptEntry.channel),
      isFinal: Boolean(transcriptEntry.isFinal),
      receivedAt: Date.now()
    };
  }).filter(Boolean);
}

function updateTranscript(conversationId, entries) {
  const history = transcriptsByConversation.get(conversationId) || [];
  entries.forEach((entry) => {
    const index = history.findIndex((existing) => existing.utteranceId === entry.utteranceId);
    if (index >= 0) history[index] = entry;
    else history.push(entry);
  });
  transcriptsByConversation.set(conversationId, history.slice(-100));
  activeConversationId = conversationId;
  renderTranscriptEntries(transcriptsByConversation.get(conversationId));
}

function findFirstString(value, keys) {
  if (!value || typeof value !== "object") return "";
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      const found = findFirstString(child, keys);
      if (found) return found;
    }
  }
  return "";
}

function handleIntentEvent(body) {
  const name = findFirstString(body, ["intentName", "intent", "name", "label", "topic"]) || "Customer intent detected";
  const detail = findFirstString(body, ["description", "summary", "utterance", "text", "evidence"]);
  renderIntentRecommendation({ name, detail, action: "Create follow-up task" });
}

function handleSummaryEvent(body) {
  const summary = findFirstString(body, ["summary", "conversationSummary", "text", "content"]);
  renderConversationSummary(summary);
}

function extractConversationId(details) {
  const topicParts = String(details.topicName || "").split(".");
  const conversationIndex = topicParts.indexOf("conversations");
  return topicParts[conversationIndex + 1] || details.eventBody?.conversationId || details.eventBody?.id || activeConversationId;
}

async function subscribe(topics) {
  const newTopics = topics.filter((topic) => topic && !subscribedTopics.has(topic));
  if (!newTopics.length) return;
  await notificationApi.postNotificationsChannelSubscriptions(notificationChannelId, newTopics.map((id) => ({ id })));
  newTopics.forEach((topic) => subscribedTopics.add(topic));
}

async function subscribeToConversation(conversationId) {
  if (!conversationId || conversationId === "Unknown") return;
  activeConversationId = conversationId;
  await subscribe([
    `v2.conversations.${conversationId}.transcription`,
    `v2.conversations.${conversationId}.suggestions.intent`
  ]);
}

async function handleNotification(event) {
  const details = JSON.parse(event.data);
  if (!details?.topicName || details?.eventBody?.message === "WebSocket Heartbeat") return;

  const topic = details.topicName;
  const conversationId = extractConversationId(details);
  if (topic.endsWith(".transcription")) updateTranscript(conversationId, extractTranscriptEntries(details.eventBody));
  else if (topic.endsWith(".suggestions.intent")) handleIntentEvent(details.eventBody);
  else if (topic.endsWith(".conversations.summaries")) handleSummaryEvent(details.eventBody);
  else if (topic.startsWith(`v2.users.`) && topic.endsWith(".conversations")) {
    const ids = new Set([details.eventBody?.id, details.eventBody?.conversationId]);
    for (const participant of details.eventBody?.participants || []) ids.add(participant?.conversationId);
    for (const id of ids) if (typeof id === "string" && id.length > 10) await subscribeToConversation(id);
  }
}

async function connectToGenesys() {
  if (!genesysConfig.region || !genesysConfig.clientId) {
    setConnectionState("waiting", "Demo mode - add Genesys URL parameters to connect");
    renderTranscriptEntries(sampleTranscript);
    return;
  }
  try {
    setConnectionState("waiting", "Signing in to Genesys Cloud");
    if (typeof require !== "function") throw new Error("The Genesys Cloud SDK did not load.");
    const platformClient = require("platformClient");
    apiClient = platformClient.ApiClient.instance;
    apiClient.setEnvironment(genesysConfig.region);
    apiClient.setPersistSettings(true, "_copilot_monitor_");
    await apiClient.loginPKCEGrant(genesysConfig.clientId, genesysConfig.redirectUrl, {});
    usersApi = new platformClient.UsersApi();
    notificationApi = new platformClient.NotificationsApi();
    const user = await usersApi.getUsersMe({});
    const channel = await notificationApi.postNotificationsChannels();
    notificationChannelId = channel.id;
    notificationSocket = new WebSocket(channel.connectUri);
    notificationSocket.onmessage = (event) => handleNotification(event).catch((error) => console.error("Genesys notification error", error));
    notificationSocket.onclose = () => setConnectionState("error", "Genesys connection closed");
    await subscribe([`v2.users.${user.id}.conversations`, `v2.users.${user.id}.conversations.summaries`]);
    const requestedConversationId = url.searchParams.get("gc_conversationId");
    if (requestedConversationId) await subscribeToConversation(requestedConversationId);
    demoButton.hidden = true;
    setConnectionState("live", "Live - subscribed to Genesys Cloud");
  } catch (error) {
    console.error("Genesys Cloud connection error", error);
    setConnectionState("error", "Unable to connect to Genesys Cloud");
  }
}

intentAction.addEventListener("click", () => {
  intentAction.textContent = "Follow-up task created";
  intentAction.disabled = true;
  intentAction.classList.remove("flash");
});

summaryLike.addEventListener("click", () => {
  const isHelpful = summaryLike.getAttribute("aria-pressed") === "true";
  summaryLike.setAttribute("aria-pressed", String(!isHelpful));
  summaryLike.querySelector("span").textContent = isHelpful ? "Helpful" : "Thanks";
});

demoButton.addEventListener("click", () => {
  sampleTranscript.push({ channel: "internal", time: "Now", text: "You are welcome. Is there anything else I can help you with today?", isFinal: false });
  renderTranscriptEntries(sampleTranscript);
  renderIntentRecommendation({ name: "Transfer status", detail: "The customer is asking for an update on a pending transfer.", action: "Create follow-up task" });
  renderConversationSummary("Jamie called about a pending transfer sent yesterday afternoon. The agent confirmed it is processing normally and is expected to complete by the end of today. No additional support was requested.");
  demoButton.disabled = true;
  demoButton.textContent = "Live update received";
});

window.renderIntentRecommendation = renderIntentRecommendation;
window.renderConversationSummary = renderConversationSummary;
window.addEventListener("load", connectToGenesys);
