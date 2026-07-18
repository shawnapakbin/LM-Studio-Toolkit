/**
 * LLM Toolkit — AskUser Interview UI
 * Polls for pending interviews and renders interactive HTML forms.
 */

const API_BASE = window.location.origin; // Dynamic: uses whatever port the page was served from
const POLL_INTERVAL = 2000; // 2 seconds

let currentInterviews = [];
let _pollTimer = null;

// ─── Polling ────────────────────────────────────────────────────────────────

async function fetchPendingInterviews() {
  try {
    const res = await fetch(`${API_BASE}/api/interviews/pending`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.interviews || [];
  } catch (err) {
    console.error("Poll error:", err);
    return null;
  }
}

async function poll() {
  const interviews = await fetchPendingInterviews();
  if (interviews === null) {
    updateStatusBar("Connection error — retrying...");
    return;
  }

  const newIds = interviews.map((i) => i.id).join(",");
  const oldIds = currentInterviews.map((i) => i.id).join(",");

  if (newIds !== oldIds) {
    currentInterviews = interviews;
    render();
    // Bring window to front when new interviews appear
    if (interviews.length > 0 && newIds !== oldIds) {
      bringToFront();
    }
  }

  const count = interviews.length;
  updateStatusBar(
    count === 0
      ? "No pending interviews. Polling..."
      : `${count} pending interview${count > 1 ? "s" : ""}`,
  );
}

function startPolling() {
  poll();
  _pollTimer = setInterval(poll, POLL_INTERVAL);
}

function updateStatusBar(text) {
  document.getElementById("status-bar").textContent = text;
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function render() {
  const container = document.getElementById("interviews-container");

  if (currentInterviews.length === 0) {
    container.innerHTML = `
      <div id="empty-state" class="empty-state">
        <p>No pending interviews. Waiting for agent requests...</p>
        <div class="spinner"></div>
      </div>
    `;
    return;
  }

  container.innerHTML = currentInterviews.map(renderInterviewCard).join("");
}

function renderInterviewCard(interview) {
  const expiresAt = new Date(interview.expiresAt);
  const isExpired = expiresAt.getTime() <= Date.now();
  const timeLeft = isExpired ? "Expired" : formatTimeLeft(expiresAt);

  return `
    <div class="interview-card" id="card-${interview.id}">
      <h2>${escapeHtml(interview.title || "Interview")}${isExpired ? '<span class="expired-badge">EXPIRED</span>' : ""}</h2>
      <div class="interview-meta">
        <span>⏱ ${timeLeft}</span>
        <span>📝 ${interview.questions.length} question${interview.questions.length > 1 ? "s" : ""}</span>
        <span>ID: ${interview.id.slice(0, 8)}...</span>
      </div>
      <form onsubmit="handleSubmit(event, '${interview.id}')" id="form-${interview.id}">
        ${interview.questions.map((q, i) => renderQuestion(q, i, interview.id)).join("")}
        <button type="submit" class="submit-btn" ${isExpired ? "disabled" : ""}>
          ${isExpired ? "Interview Expired" : "Submit Responses"}
        </button>
      </form>
    </div>
  `;
}

function renderQuestion(question, index, interviewId) {
  const requiredBadge = question.required ? '<span class="required-badge">required</span>' : "";
  const fieldId = `${interviewId}-${question.id}`;

  let inputHtml = "";

  switch (question.type) {
    case "text":
      inputHtml = renderTextQuestion(question, fieldId);
      break;
    case "single_choice":
      inputHtml = renderSingleChoice(question, fieldId);
      break;
    case "multi_choice":
      inputHtml = renderMultiChoice(question, fieldId);
      break;
    case "number":
      inputHtml = renderNumberQuestion(question, fieldId);
      break;
    case "confirm":
      inputHtml = renderConfirmQuestion(question, fieldId);
      break;
    default:
      inputHtml = `<p>Unsupported question type: ${question.type}</p>`;
  }

  return `
    <div class="question-block" data-question-id="${question.id}" data-question-type="${question.type}">
      <label>${index + 1}. ${escapeHtml(question.prompt)}${requiredBadge}</label>
      ${inputHtml}
    </div>
  `;
}

function renderTextQuestion(question, fieldId) {
  const minLen = question.minLength ? `minlength="${question.minLength}"` : "";
  const maxLen = question.maxLength ? `maxlength="${question.maxLength}"` : "";
  return `<textarea id="${fieldId}" name="${question.id}" ${minLen} ${maxLen} placeholder="Type your answer..."></textarea>`;
}

function renderSingleChoice(question, fieldId) {
  const options = (question.options || [])
    .map(
      (opt) => `
      <div class="option-item">
        <input type="radio" name="${question.id}" id="${fieldId}-${opt.id}" value="${opt.id}">
        <label for="${fieldId}-${opt.id}">${escapeHtml(opt.label)}</label>
      </div>
    `,
    )
    .join("");
  return `<div class="option-group">${options}</div>`;
}

function renderMultiChoice(question, fieldId) {
  const options = (question.options || [])
    .map(
      (opt) => `
      <div class="option-item">
        <input type="checkbox" name="${question.id}" id="${fieldId}-${opt.id}" value="${opt.id}">
        <label for="${fieldId}-${opt.id}">${escapeHtml(opt.label)}</label>
      </div>
    `,
    )
    .join("");
  return `<div class="option-group">${options}</div>`;
}

function renderNumberQuestion(question, fieldId) {
  const min = question.min !== undefined ? `min="${question.min}"` : "";
  const max = question.max !== undefined ? `max="${question.max}"` : "";
  const step = question.integerOnly ? 'step="1"' : 'step="any"';
  const placeholder = [
    question.min !== undefined ? `min: ${question.min}` : "",
    question.max !== undefined ? `max: ${question.max}` : "",
    question.integerOnly ? "integers only" : "",
  ]
    .filter(Boolean)
    .join(", ");
  return `<input type="number" id="${fieldId}" name="${question.id}" ${min} ${max} ${step} placeholder="${placeholder || "Enter a number"}">`;
}

function renderConfirmQuestion(question, fieldId) {
  return `
    <div class="confirm-toggle" id="${fieldId}">
      <button type="button" class="confirm-btn" data-value="true" onclick="selectConfirm(this, '${fieldId}')">✓ Yes</button>
      <button type="button" class="confirm-btn" data-value="false" onclick="selectConfirm(this, '${fieldId}')">✗ No</button>
      <input type="hidden" name="${question.id}" value="">
    </div>
  `;
}

// ─── Interaction ────────────────────────────────────────────────────────────

function selectConfirm(btn, fieldId) {
  const container = document.getElementById(fieldId);
  const buttons = container.querySelectorAll(".confirm-btn");
  const hiddenInput = container.querySelector('input[type="hidden"]');

  buttons.forEach((b) => b.classList.remove("selected-yes", "selected-no"));

  const value = btn.getAttribute("data-value");
  hiddenInput.value = value;

  if (value === "true") {
    btn.classList.add("selected-yes");
  } else {
    btn.classList.add("selected-no");
  }
}

async function handleSubmit(event, interviewId) {
  event.preventDefault();
  const form = document.getElementById(`form-${interviewId}`);
  const submitBtn = form.querySelector(".submit-btn");
  const card = document.getElementById(`card-${interviewId}`);

  // Collect responses
  const interview = currentInterviews.find((i) => i.id === interviewId);
  if (!interview) return;

  const responses = [];
  let hasError = false;

  for (const question of interview.questions) {
    const block = form.querySelector(`[data-question-id="${question.id}"]`);
    let value = null;

    switch (question.type) {
      case "text": {
        const textarea = form.querySelector(`[name="${question.id}"]`);
        value = textarea ? textarea.value.trim() : "";
        break;
      }
      case "single_choice": {
        const checked = form.querySelector(`[name="${question.id}"]:checked`);
        value = checked ? checked.value : "";
        break;
      }
      case "multi_choice": {
        const checked = form.querySelectorAll(`[name="${question.id}"]:checked`);
        value = Array.from(checked).map((el) => el.value);
        break;
      }
      case "number": {
        const input = form.querySelector(`[name="${question.id}"]`);
        value = input && input.value !== "" ? Number(input.value) : null;
        break;
      }
      case "confirm": {
        const hidden = form.querySelector(`[name="${question.id}"]`);
        if (hidden && hidden.value !== "") {
          value = hidden.value === "true";
        }
        break;
      }
    }

    // Validate required
    if (question.required) {
      const isEmpty =
        value === null ||
        value === "" ||
        value === undefined ||
        (Array.isArray(value) && value.length === 0);
      if (isEmpty) {
        hasError = true;
        block.style.borderColor = "#ef4444";
        if (!block.querySelector(".error-message")) {
          block.insertAdjacentHTML(
            "beforeend",
            '<div class="error-message">This field is required</div>',
          );
        }
      } else {
        block.style.borderColor = "";
        const err = block.querySelector(".error-message");
        if (err) err.remove();
      }
    }

    if (value !== null && value !== "" && !(Array.isArray(value) && value.length === 0)) {
      responses.push({ questionId: question.id, value });
    }
  }

  if (hasError) return;

  // Submit
  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting...";

  try {
    const res = await fetch(`${API_BASE}/tools/ask_user_interview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "submit",
        payload: { interviewId, responses },
      }),
    });

    const data = await res.json();

    if (data.success) {
      card.innerHTML = `
        <div class="success-message">
          <div class="checkmark">✓</div>
          <p>Response submitted successfully!</p>
        </div>
      `;
      // Remove from local list after a short delay
      setTimeout(() => {
        currentInterviews = currentInterviews.filter((i) => i.id !== interviewId);
        render();
      }, 2000);
    } else {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Responses";
      form.insertAdjacentHTML(
        "beforeend",
        `<div class="error-message">${escapeHtml(data.errorMessage || "Submission failed")}</div>`,
      );
    }
  } catch (err) {
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit Responses";
    form.insertAdjacentHTML(
      "beforeend",
      `<div class="error-message">Network error: ${escapeHtml(err.message)}</div>`,
    );
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatTimeLeft(expiresAt) {
  const diff = expiresAt.getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m remaining`;
  return `${minutes}m remaining`;
}

// ─── Init ───────────────────────────────────────────────────────────────────

// Request window focus when page loads (for always-on-top behavior)
window.focus();

// If this page was opened programmatically, try to bring it to front
if (window.opener || document.visibilityState === "visible") {
  window.focus();
}

// Also re-focus when new interviews arrive
function bringToFront() {
  window.focus();
  // Flash the title to grab attention if not focused
  if (document.hidden) {
    const originalTitle = document.title;
    let flash = true;
    const interval = setInterval(() => {
      document.title = flash ? "⚡ New Interview!" : originalTitle;
      flash = !flash;
    }, 500);
    const onFocus = () => {
      clearInterval(interval);
      document.title = originalTitle;
      window.removeEventListener("focus", onFocus);
    };
    window.addEventListener("focus", onFocus);
    // Stop flashing after 30s regardless
    setTimeout(() => {
      clearInterval(interval);
      document.title = originalTitle;
      window.removeEventListener("focus", onFocus);
    }, 30000);
  }
}

startPolling();
