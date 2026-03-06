const apiModal = document.getElementById('api-modal');
const apiKeyInput = document.getElementById('api-key-input');
const saveKeyBtn = document.getElementById('save-key-btn');
const sourceModal = document.getElementById('source-modal');
const sourceText = document.getElementById('source-text');
const closeSourceBtn = document.getElementById('close-source-btn');
const chatWindow = document.getElementById('chat-window');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const suggestionsContainer = document.getElementById('suggestions-container');

let apiKey = localStorage.getItem('gemini_api_key');

// Check API Key on load
if (!apiKey) {
    apiModal.classList.remove('hidden');
} else {
    apiModal.classList.add('hidden');
    loadSuggestions(); // Fetch suggestions if key already exists
}

saveKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key) {
        apiKey = key;
        localStorage.setItem('gemini_api_key', key);
        apiModal.classList.add('hidden');
        loadSuggestions(); // Fetch suggestions on new key enter
    }
});

closeSourceBtn.addEventListener('click', () => {
    sourceModal.classList.add('hidden');
});

// Fetch dynamic suggestions from backend
async function loadSuggestions() {
    try {
        const response = await fetch('/api/suggestions');
        if (response.ok) {
            const data = await response.json();
            renderSuggestions(data.suggestions);
        }
    } catch (err) {
        console.error("Failed to load suggestions:", err);
    }
}

function renderSuggestions(suggestions) {
    suggestionsContainer.innerHTML = ''; // Clear out old ones
    if (suggestions && suggestions.length > 0) {
        suggestions.forEach(text => {
            const chip = document.createElement('div');
            chip.className = 'suggestion-chip';
            chip.textContent = text;
            chip.draggable = true;
            
            // Drag and Drop Logic for Chips
            chip.addEventListener('dragstart', (e) => {
                chip.classList.add('dragging');
                e.dataTransfer.setData('text/plain', text);
            });
            
            chip.addEventListener('dragend', () => {
                chip.classList.remove('dragging');
            });
            
            // Allow clicking to auto-fill as an alternative to dragging
            chip.addEventListener('click', () => {
               userInput.value = text;
               userInput.style.height = 'auto';
               userInput.style.height = (userInput.scrollHeight) + 'px';
               userInput.focus();
            });

            suggestionsContainer.appendChild(chip);
        });
        suggestionsContainer.classList.remove('hidden');
    }
}

// Drag and Drop Logic for Textarea
userInput.addEventListener('dragover', (e) => {
    e.preventDefault(); // Necessary to allow dropping
    userInput.classList.add('drag-over');
});

userInput.addEventListener('dragleave', () => {
    userInput.classList.remove('drag-over');
});

userInput.addEventListener('drop', (e) => {
    e.preventDefault();
    userInput.classList.remove('drag-over');
    
    // Attempt to get text from the dragged item
    const droppedText = e.dataTransfer.getData('text/plain');
    if (droppedText) {
        userInput.value = droppedText;
        // Auto-expand the textarea so the user can read the dropped text
        userInput.style.height = 'auto';
        userInput.style.height = (userInput.scrollHeight) + 'px';
    }
});

// Auto-expand textarea
userInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
});

// Allow Enter to send, Shift+Enter for new line
userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

sendBtn.addEventListener('click', sendMessage);

async function sendMessage() {
    const text = userInput.value.trim();
    if (!text || !apiKey) return;

    // Reset input
    userInput.value = '';
    userInput.style.height = 'auto';

    // Hide suggestions once a conversation starts
    suggestionsContainer.classList.add('hidden');

    // Add user message
    addMessage(text, 'user');

    // Add typing indicator
    const typingId = 'typing-' + Date.now();
    const typingHtml = `<div id="${typingId}" class="typing-indicator">Assistant is thinking...</div>`;
    chatWindow.insertAdjacentHTML('beforeend', typingHtml);
    chatWindow.scrollTop = chatWindow.scrollHeight;

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey
            },
            body: JSON.stringify({ question: text })
        });

        const typingEl = document.getElementById(typingId);
        if (typingEl) typingEl.remove();

        if (response.status === 401) {
            localStorage.removeItem('gemini_api_key');
            apiKey = null;
            apiModal.classList.remove('hidden');
            addMessage("API key is invalid or missing. Please provide it.", 'system');
            return;
        }

        const data = await response.json();
        
        if (response.ok) {
            addMessage(data.answer, 'system', data.source_chunk);
        } else {
            addMessage(`Error: ${data.detail}`, 'system');
        }

    } catch (err) {
        const typingEl = document.getElementById(typingId);
        if (typingEl) typingEl.remove();
        addMessage(`Network Error: ${err.message}`, 'system');
    }
}

function addMessage(text, sender, sourceChunk = null) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${sender}-msg`;
    
    // Convert basic markdown/newlines to HTML
    const formattedText = text.replace(/\\n/g, '<br />');

    let innerHtml = `<div class="msg-content">${formattedText}</div>`;
    
    if (sourceChunk) {
        innerHtml += `<button class="source-btn" onclick="showSource('${encodeURIComponent(sourceChunk)}')">View Source</button>`;
    }

    msgDiv.innerHTML = innerHtml;
    chatWindow.appendChild(msgDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

window.showSource = function(encodedText) {
    const decoded = decodeURIComponent(encodedText);
    sourceText.textContent = decoded;
    sourceModal.classList.remove('hidden');
}
