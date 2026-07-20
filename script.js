const sampleTranscript = [
  { channel: "external", speaker: "Jamie", time: "10:25 AM", text: "Hi, I’m trying to find out why my last transfer is still pending." },
  { channel: "internal", speaker: "Maya", time: "10:25 AM", text: "I can help with that. Let me take a quick look at the transfer details for you." },
  { channel: "external", speaker: "Jamie", time: "10:26 AM", text: "Thank you. It was sent yesterday afternoon." },
  { channel: "internal", speaker: "Maya", time: "10:27 AM", text: "I see it here. It’s processing normally and should be complete by the end of today." },
  { channel: "external", speaker: "Jamie", time: "10:28 AM", text: "Perfect, that’s all I needed to know." }
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
  time.textContent = entry.time || "Now";
  meta.append(speaker, time);
  const bubble = document.createElement("p");
  bubble.className = "bubble";
  bubble.textContent = entry.text;
  content.append(meta, bubble);
  message.append(avatar, content);
  return message;
}

renderTranscriptEntries(sampleTranscript);

function renderIntentRecommendation(intent) {
  intentName.textContent = intent.name;
  intentDetail.textContent = intent.detail;
  intentAction.textContent = intent.action || "Create follow-up task";
  intentAction.disabled = false;
  intentPanel.hidden = false;
  intentAction.classList.remove("flash");
  void intentAction.offsetWidth;
  intentAction.classList.add("flash");
}

function renderConversationSummary(summary) {
  summaryText.textContent = summary;
  summaryPanel.hidden = false;
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
  sampleTranscript.push({
    channel: "internal",
    speaker: "Maya",
    time: "Now",
    text: "You’re welcome. Is there anything else I can help you with today?",
    isFinal: false
  });
  renderTranscriptEntries(sampleTranscript);
  renderIntentRecommendation({
    name: "Transfer status",
    detail: "The customer is asking for an update on a pending transfer.",
    action: "Create follow-up task"
  });
  renderConversationSummary("Jamie called about a pending transfer sent yesterday afternoon. Maya confirmed the transfer is processing normally and is expected to complete by the end of today. No additional support was requested.");
  demoButton.disabled = true;
  demoButton.textContent = "Live update received";
});

// Feed live Genesys entries into this component by calling:
// renderTranscriptEntries(extractTranscriptEntries(eventBody));
// On matching notifications, call renderIntentRecommendation(intent) and
// renderConversationSummary(summaryText) to update these contextual panels.
