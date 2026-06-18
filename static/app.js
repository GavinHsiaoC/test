const STORAGE_KEY = "llm-sdk-chat-lab.config";

const state = {
  messages: [],
  controller: null,
  lastTrace: null,
};

const elements = {
  provider: document.getElementById("provider"),
  model: document.getElementById("model"),
  baseUrl: document.getElementById("baseUrl"),
  protocol: document.getElementById("protocol"),
  apiKey: document.getElementById("apiKey"),
  rememberApiKey: document.getElementById("rememberApiKey"),
  stream: document.getElementById("stream"),
  temperature: document.getElementById("temperature"),
  topP: document.getElementById("topP"),
  maxTokens: document.getElementById("maxTokens"),
  timeout: document.getElementById("timeout"),
  maxRetries: document.getElementById("maxRetries"),
  systemPrompt: document.getElementById("systemPrompt"),
  extraHeaders: document.getElementById("extraHeaders"),
  extraBody: document.getElementById("extraBody"),
  providerOptions: document.getElementById("providerOptions"),
  messageList: document.getElementById("messageList"),
  promptInput: document.getElementById("promptInput"),
  composer: document.getElementById("composer"),
  sendButton: document.getElementById("sendButton"),
  stopStream: document.getElementById("stopStream"),
  clearChat: document.getElementById("clearChat"),
  saveConfig: document.getElementById("saveConfig"),
  clearConfig: document.getElementById("clearConfig"),
  statusBadge: document.getElementById("statusBadge"),
  traceOutput: document.getElementById("traceOutput"),
};

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.warn("Failed to load config", error);
    return {};
  }
}

function saveConfig(showStatus = true) {
  const config = collectFormValues({ allowInvalidJson: true });
  const payload = { ...config, apiKey: config.rememberApiKey ? config.apiKey : "" };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  if (showStatus) {
    setStatus("配置已保存", "idle");
  }
}

function hydrateConfig() {
  const config = loadConfig();
  elements.provider.value = config.provider || "";
  elements.model.value = config.model || "";
  elements.baseUrl.value = config.baseUrl || "";
  elements.protocol.value = config.protocol || "";
  elements.apiKey.value = config.apiKey || "";
  elements.rememberApiKey.checked = Boolean(config.rememberApiKey);
  elements.stream.checked = config.stream !== false;
  elements.temperature.value = config.temperature ?? 0.7;
  elements.topP.value = config.topP ?? 1;
  elements.maxTokens.value = config.maxTokens || "";
  elements.timeout.value = config.timeout ?? 60;
  elements.maxRetries.value = config.maxRetries ?? 1;
  elements.systemPrompt.value = config.systemPrompt || "";
  elements.extraHeaders.value = config.extraHeadersText || "";
  elements.extraBody.value = config.extraBodyText || "";
  elements.providerOptions.value = config.providerOptionsText || "";
}

function parseJsonField(value, fieldName, allowInvalidJson = false) {
  if (!value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
      throw new Error(`${fieldName} 必须是 JSON 对象`);
    }
    return parsed;
  } catch (error) {
    if (allowInvalidJson) {
      return {};
    }
    throw new Error(`${fieldName} JSON 格式不正确: ${error.message}`);
  }
}

function collectFormValues(options = {}) {
  const allowInvalidJson = Boolean(options.allowInvalidJson);
  const extraHeadersText = elements.extraHeaders.value.trim();
  const extraBodyText = elements.extraBody.value.trim();
  const providerOptionsText = elements.providerOptions.value.trim();

  return {
    provider: elements.provider.value.trim(),
    model: elements.model.value.trim(),
    baseUrl: elements.baseUrl.value.trim(),
    protocol: elements.protocol.value,
    apiKey: elements.apiKey.value.trim(),
    rememberApiKey: elements.rememberApiKey.checked,
    stream: elements.stream.checked,
    temperature: elements.temperature.value === "" ? "" : Number(elements.temperature.value),
    topP: elements.topP.value === "" ? "" : Number(elements.topP.value),
    maxTokens: elements.maxTokens.value === "" ? "" : Number(elements.maxTokens.value),
    timeout: elements.timeout.value === "" ? "" : Number(elements.timeout.value),
    maxRetries: elements.maxRetries.value === "" ? "" : Number(elements.maxRetries.value),
    systemPrompt: elements.systemPrompt.value.trim(),
    extraHeaders: parseJsonField(extraHeadersText, "extra_headers", allowInvalidJson),
    extraBody: parseJsonField(extraBodyText, "extra_body", allowInvalidJson),
    providerOptions: parseJsonField(providerOptionsText, "provider_options", allowInvalidJson),
    extraHeadersText,
    extraBodyText,
    providerOptionsText,
  };
}

function buildSdkConfig() {
  const values = collectFormValues();
  const config = {
    provider: values.provider,
    model: values.model,
    api_key: values.apiKey,
    base_url: values.baseUrl,
    protocol: values.protocol,
    temperature: values.temperature,
    top_p: values.topP,
    max_tokens: values.maxTokens,
    timeout: values.timeout,
    max_retries: values.maxRetries,
    extra_headers: values.extraHeaders,
    extra_body: values.extraBody,
    provider_options: values.providerOptions,
  };

  Object.keys(config).forEach((key) => {
    const value = config[key];
    if (value === "" || value === null || value === undefined) {
      delete config[key];
    }
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
      delete config[key];
    }
  });

  if (!config.provider) {
    throw new Error("请填写 provider");
  }
  if (!config.model) {
    throw new Error("请填写模型名称");
  }

  return config;
}

function buildMessages(nextUserMessage) {
  const values = collectFormValues({ allowInvalidJson: true });
  const messages = [];

  if (values.systemPrompt) {
    messages.push({ role: "system", content: values.systemPrompt });
  }

  state.messages.forEach((message) => {
    messages.push({ role: message.role, content: message.content });
  });

  messages.push({ role: "user", content: nextUserMessage });
  return messages;
}

function setStatus(text, tone = "idle") {
  elements.statusBadge.textContent = text;
  elements.statusBadge.dataset.tone = tone;
}

function updateTrace(payload) {
  state.lastTrace = payload;
  elements.traceOutput.textContent = JSON.stringify(payload, null, 2);
}

function renderMessages() {
  if (!state.messages.length) {
    elements.messageList.innerHTML = `
      <article class="empty-state">
        <h3>从这里开始试模型</h3>
        <p>先填入厂商、模型、地址和 API Key，再发送第一条消息。</p>
      </article>
    `;
    return;
  }

  elements.messageList.innerHTML = state.messages
    .map(
      (message, index) => `
        <article class="message ${message.role}" style="animation-delay: ${Math.min(index * 40, 240)}ms">
          <header>
            <span>${message.role === "user" ? "你" : "助手"}</span>
            <small>${message.mode || ""}</small>
          </header>
          <div class="message-body">${escapeHtml(message.content).replace(/\n/g, "<br>")}</div>
        </article>
      `,
    )
    .join("");

  elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

function renderSingleMessage(message, index) {
  const article = document.createElement("article");
  article.className = `message ${message.role}`;
  article.style.animationDelay = `${Math.min(index * 40, 240)}ms`;

  const header = document.createElement("header");
  const name = document.createElement("span");
  name.textContent = message.role === "user" ? "你" : "助手";
  const mode = document.createElement("small");
  mode.textContent = message.mode || "";
  header.append(name, mode);

  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = message.content;

  article.append(header, body);
  return article;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setBusy(isBusy) {
  elements.sendButton.disabled = isBusy;
  elements.stopStream.disabled = !isBusy;
  elements.promptInput.disabled = isBusy;
}

function appendMessage(role, content, mode = "") {
  const wasEmpty = state.messages.length === 0;
  const message = { role, content, mode };
  state.messages.push(message);

  if (wasEmpty) {
    elements.messageList.innerHTML = "";
  }

  elements.messageList.appendChild(renderSingleMessage(message, state.messages.length - 1));
  elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

function replaceLastAssistant(content) {
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage && lastMessage.role === "assistant") {
    lastMessage.content = content;
    const body = elements.messageList.querySelector(".message.assistant:last-child .message-body");
    if (body) {
      body.textContent = content;
      elements.messageList.scrollTop = elements.messageList.scrollHeight;
    } else {
      renderMessages();
    }
  }
}

async function sendMessage(event) {
  event.preventDefault();
  if (state.controller) {
    return;
  }

  const prompt = elements.promptInput.value.trim();
  if (!prompt) {
    setStatus("请输入消息内容", "error");
    return;
  }

  try {
    const config = buildSdkConfig();
    saveConfig(false);
    const messages = buildMessages(prompt);
    const mode = elements.stream.checked ? "流式" : "非流式";

    appendMessage("user", prompt, mode);
    appendMessage("assistant", "", mode);
    elements.promptInput.value = "";
    setBusy(true);
    setStatus("正在请求模型...", "working");

    if (elements.stream.checked) {
      await sendStreamChat(config, messages);
    } else {
      await sendPlainChat(config, messages);
    }

    setStatus("响应完成", "success");
  } catch (error) {
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage && lastMessage.role === "assistant" && !lastMessage.content) {
      lastMessage.content = `请求失败：${error.message}`;
      renderMessages();
    }
    setStatus(error.message, "error");
    updateTrace({ error: error.message, at: new Date().toISOString() });
  } finally {
    state.controller = null;
    setBusy(false);
  }
}

async function sendPlainChat(config, messages) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config, messages }),
  });

  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error?.message || "模型调用失败");
  }

  replaceLastAssistant(payload.response.content || "");
  updateTrace({
    mode: "plain",
    request: redactConfig(config),
    response: payload.response,
  });
}

async function sendStreamChat(config, messages) {
  state.controller = new AbortController();

  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config, messages }),
    signal: state.controller.signal,
  });

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error?.message || "流式连接建立失败");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let assistantText = "";
  let finalChunk = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      const event = JSON.parse(line);
      if (event.type === "delta") {
        assistantText += event.delta || "";
        finalChunk = event.chunk || finalChunk;
        replaceLastAssistant(assistantText);
      } else if (event.type === "done") {
        assistantText = event.content || assistantText;
        finalChunk = event.chunk || finalChunk;
        replaceLastAssistant(assistantText);
      } else if (event.type === "error") {
        throw new Error(event.error?.message || "流式调用失败");
      }
    }
  }

  updateTrace({
    mode: "stream",
    request: redactConfig(config),
    finalChunk,
    content: assistantText,
  });
}

function redactConfig(config) {
  const cloned = { ...config };
  if (cloned.api_key) {
    const tail = cloned.api_key.slice(-4);
    cloned.api_key = `***${tail}`;
  }
  return cloned;
}

function stopStreaming() {
  if (state.controller) {
    state.controller.abort();
    state.controller = null;
    setStatus("已中止流式输出", "idle");
  }
}

function clearChat() {
  state.messages = [];
  renderMessages();
  updateTrace({ hint: "会话已清空" });
  setStatus("会话已清空", "idle");
}

function clearConfig() {
  localStorage.removeItem(STORAGE_KEY);
  elements.provider.value = "";
  elements.model.value = "";
  elements.baseUrl.value = "";
  elements.protocol.value = "";
  elements.apiKey.value = "";
  elements.rememberApiKey.checked = false;
  elements.stream.checked = true;
  elements.temperature.value = 0.7;
  elements.topP.value = 1;
  elements.maxTokens.value = "";
  elements.timeout.value = 60;
  elements.maxRetries.value = 1;
  elements.systemPrompt.value = "";
  elements.extraHeaders.value = "";
  elements.extraBody.value = "";
  elements.providerOptions.value = "";
  setStatus("配置已清空", "idle");
}

function bindEvents() {
  elements.composer.addEventListener("submit", sendMessage);
  elements.stopStream.addEventListener("click", stopStreaming);
  elements.clearChat.addEventListener("click", clearChat);
  elements.saveConfig.addEventListener("click", () => saveConfig(true));
  elements.clearConfig.addEventListener("click", clearConfig);
  elements.promptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.ctrlKey) {
      sendMessage(event);
    }
  });

  [
    elements.provider,
    elements.model,
    elements.baseUrl,
    elements.protocol,
    elements.stream,
    elements.temperature,
    elements.topP,
    elements.maxTokens,
    elements.timeout,
    elements.maxRetries,
    elements.systemPrompt,
    elements.extraHeaders,
    elements.extraBody,
    elements.providerOptions,
    elements.rememberApiKey,
  ].forEach((element) => {
    element.addEventListener("change", () => saveConfig(false));
  });
}

hydrateConfig();
bindEvents();
renderMessages();
updateTrace({ hint: "发送一条消息后，这里会出现响应详情" });
setStatus("待命", "idle");
