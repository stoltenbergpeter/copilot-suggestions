const transcript = document.querySelector("#transcript");
const messageCount = document.querySelector("#message-count");
const intentPanel = document.querySelector("#intent-panel");
const intentName = document.querySelector("#intent-name");
const intentDetail = document.querySelector("#intent-detail");
const intentAction = document.querySelector("#intent-action");
const taskPanel = document.querySelector("#task-panel");
const taskForm = document.querySelector("#task-form");
const taskTitle = document.querySelector("#task-title");
const taskDueDate = document.querySelector("#task-due-date");
const taskPriority = document.querySelector("#task-priority");
const taskOwner = document.querySelector("#task-owner");
const taskNotes = document.querySelector("#task-notes");
const taskIntent = document.querySelector("#task-intent");
const taskConversation = document.querySelector("#task-conversation");
const closeTask = document.querySelector("#close-task");
const cancelTask = document.querySelector("#cancel-task");
const summaryPanel = document.querySelector("#summary-panel");
const summaryText = document.querySelector("#summary-text");
const tagsPanel = document.querySelector("#tags-panel");
const tagList = document.querySelector("#tag-list");
const summaryLike = document.querySelector("#summary-like");
const syncSummary = document.querySelector("#sync-summary");
const notesEditor = document.querySelector("#notes-editor");
const connectionStatus = document.querySelector("#connection-status");
const connectionLabel = document.querySelector("#connection-label");

const url = new URL(window.location.href);
const defaultGenesysRegion = "usw2.pure.cloud";
const defaultGenesysClientId = "409225b8-66a3-407c-92ad-fa386bad3e79";
const genesysConfig = {
  region: normalizeRegion(url.searchParams.get("gc_region") || sessionStorage.getItem("gc_region") || defaultGenesysRegion),
  clientId: url.searchParams.get("gc_clientId") || sessionStorage.getItem("gc_clientId") || defaultGenesysClientId,
  redirectUrl: url.searchParams.get("gc_redirectUrl") || sessionStorage.getItem("gc_redirectUrl") || `${window.location.origin}${window.location.pathname}`
};
if (genesysConfig.region) sessionStorage.setItem("gc_region", genesysConfig.region);
if (genesysConfig.clientId) sessionStorage.setItem("gc_clientId", genesysConfig.clientId);
if (genesysConfig.redirectUrl) sessionStorage.setItem("gc_redirectUrl", genesysConfig.redirectUrl);
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

function removeOAuthCallbackParameters() {
  if (!url.searchParams.has("code")) return;
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("code");
  cleanUrl.searchParams.delete("state");
  window.history.replaceState({}, document.title, `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
}

function isAgentChannel(channel) {
  return /internal|agent|advisor|employee/i.test(String(channel || ""));
}

function renderTranscriptEntries(entries) {
  transcript.replaceChildren();
  if (!entries.length) {
    const emptyState = document.createElement("p");
    emptyState.className = "transcript-empty";
    emptyState.textContent = "Waiting for the conversation transcript...";
    transcript.append(emptyState);
  } else {
    [...entries].reverse().forEach((entry) => transcript.append(createMessage(entry)));
  }
  messageCount.textContent = `${entries.length} ${entries.length === 1 ? "message" : "messages"}`;
  transcript.scrollTop = 0;
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
  taskPanel.hidden = true;
  intentPanel.hidden = false;
  intentAction.classList.remove("flash");
  void intentAction.offsetWidth;
  intentAction.classList.add("flash");
}

function openFollowUpTask() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  taskTitle.value = `Follow up: ${intentName.textContent}`;
  taskDueDate.value = tomorrow.toISOString().slice(0, 10);
  taskPriority.value = "Normal";
  taskOwner.value = "";
  taskNotes.value = [intentDetail.textContent, notesEditor.textContent.trim()].filter(Boolean).join("\n\n");
  taskIntent.textContent = intentName.textContent;
  taskConversation.textContent = activeConversationId || "Current conversation";
  taskPanel.hidden = false;
  taskTitle.focus();
}

function renderConversationSummary(summary) {
  if (!summary) return;
  summaryText.textContent = summary;
  renderRecommendedTags(extractDynamicsTopics(summary));
  syncSummary.textContent = "Sync to activity";
  syncSummary.disabled = false;
  summaryPanel.hidden = false;
}

function extractDynamicsTopics(summary) {
  const lines = String(summary).replace(/\r/g, "").split("\n");
  const headingIndex = lines.findIndex((line) => /dynamics\s+topic(?:\(s\)|s)?\s*:/i.test(line));
  if (headingIndex < 0) return [];

  const headingLine = lines[headingIndex];
  const afterColon = headingLine.slice(headingLine.indexOf(":") + 1).trim();
  const topicLines = afterColon ? [afterColon] : [];

  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      if (topicLines.length) break;
      continue;
    }
    if (/^[A-Z][A-Za-z0-9 /&()'-]{2,}:\s*/.test(line) && !/^[-*]/.test(line)) break;
    topicLines.push(line);
  }

  return [...new Set(
    topicLines
      .join(",")
      .replace(/[*_`]/g, "")
      .split(/[,;|]|\s+\/\s+|\n/)
      .map((topic) => topic.replace(/^[-\u2022\d.)\s]+/, "").trim())
      .filter(Boolean)
  )];
}

function renderRecommendedTags(tags) {
  tagList.replaceChildren();
  tagsPanel.hidden = !tags.length;
  tags.forEach((tag) => {
    const chip = document.createElement("span");
    chip.className = "recommended-tag";
    chip.textContent = tag;
    tagList.append(chip);
  });
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
  loadNotes();
  renderTranscriptEntries(transcriptsByConversation.get(conversationId));
}

function noteStorageKey() {
  return `genesys-conversation-notes:${activeConversationId || "draft"}`;
}

function loadNotes() {
  notesEditor.textContent = localStorage.getItem(noteStorageKey()) || "";
}

function saveNotes() {
  localStorage.setItem(noteStorageKey(), notesEditor.textContent.trim());
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
    setConnectionState("waiting", "Add Genesys URL parameters to connect");
    renderTranscriptEntries([]);
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
    removeOAuthCallbackParameters();
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
    setConnectionState("live", "Live - subscribed to Genesys Cloud");
  } catch (error) {
    console.error("Genesys Cloud connection error", error);
    setConnectionState("error", "Unable to connect to Genesys Cloud");
  }
}

intentAction.addEventListener("click", openFollowUpTask);

closeTask.addEventListener("click", () => {
  taskPanel.hidden = true;
});

cancelTask.addEventListener("click", () => {
  taskPanel.hidden = true;
});

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const task = {
    conversationId: activeConversationId,
    intent: taskIntent.textContent,
    title: taskTitle.value.trim(),
    dueDate: taskDueDate.value,
    priority: taskPriority.value,
    owner: taskOwner.value.trim(),
    notes: taskNotes.value.trim()
  };
  window.dispatchEvent(new CustomEvent("conversation-follow-up-task", { detail: task }));
  taskPanel.hidden = true;
  intentAction.textContent = "Follow-up task created";
  intentAction.disabled = true;
  intentAction.classList.remove("flash");
});

summaryLike.addEventListener("click", () => {
  const isHelpful = summaryLike.getAttribute("aria-pressed") === "true";
  summaryLike.setAttribute("aria-pressed", String(!isHelpful));
  summaryLike.querySelector("span").textContent = isHelpful ? "Helpful" : "Thanks";
});

syncSummary.addEventListener("click", () => {
  window.dispatchEvent(new CustomEvent("conversation-summary-sync", {
    detail: { conversationId: activeConversationId, summary: summaryText.textContent }
  }));
  syncSummary.textContent = "Synced to activity";
  syncSummary.disabled = true;
});

notesEditor.addEventListener("input", saveNotes);

notesEditor.addEventListener("paste", (event) => {
  event.preventDefault();
  document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
});

window.renderIntentRecommendation = renderIntentRecommendation;
window.renderConversationSummary = renderConversationSummary;
loadNotes();
window.addEventListener("load", connectToGenesys);
