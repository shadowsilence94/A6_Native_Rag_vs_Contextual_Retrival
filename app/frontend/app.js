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
const chapterSelect = document.getElementById('chapter-select');

let apiKey = localStorage.getItem('gemini_api_key');

// Initialize App
async function initApp() {
    await loadChapters();
    
    if (!apiKey) {
        apiModal.classList.remove('hidden');
    } else {
        apiModal.classList.add('hidden');
        loadSuggestions(); // Fetch suggestions for default chapter if key already exists
    }
}

initApp();

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

// Fetch discovered chapters from backend
async function loadChapters() {
    try {
        const response = await fetch('/api/chapters');
        if (response.ok) {
            const data = await response.json();
            chapterSelect.innerHTML = '';
            
            if (data.chapters.length === 0) {
                const opt = document.createElement('option');
                opt.value = "10";
                opt.textContent = "Chapter 10 (Default)";
                chapterSelect.appendChild(opt);
            } else {
                data.chapters.forEach(ch => {
                    const opt = document.createElement('option');
                    opt.value = ch;
                    opt.textContent = `Chapter ${ch}`;
                    chapterSelect.appendChild(opt);
                });
            }
        }
    } catch (err) {
        console.error("Failed to load chapters:", err);
    }
}

// Handle Chapter Selection Changes
chapterSelect.addEventListener('change', () => {
    if (apiKey) {
        // Clear chat to prevent confused contexts
        chatWindow.innerHTML = `
            <div class="message system-msg">
                <div class="msg-content">Switched to Chapter ${chapterSelect.value}. Ask me a question from this chapter!</div>
            </div>`;
        loadSuggestions();
    }
});

// Fetch dynamic suggestions from backend for specific chapter
async function loadSuggestions() {
    try {
        const currentChapter = chapterSelect.value || "10";
        const response = await fetch(`/api/suggestions?chapter=${currentChapter}`);
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

// Helper function to format basic markdown to HTML dynamically
function formatTextToHtml(text) {
    return text.replace(/\n/g, '<br />'); // Only replace basic newlines for streams
}

async function sendMessage() {
    const text = userInput.value.trim();
    const currentChapter = chapterSelect.value || "10";
    
    if (!text || !apiKey) return;

    // Reset input
    userInput.value = '';
    userInput.style.height = 'auto';

    // (Intentionally leaving suggestions visible in the sidebar to fulfill feature request)

    // Add user message to UI
    appendFullMessage(text, 'user');

    // Add empty assistant message container waiting for stream
    const msgDivId = 'msg-' + Date.now();
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message system-msg';
    msgDiv.id = msgDivId;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'msg-content blinking-cursor'; 
    msgDiv.appendChild(contentDiv);
    
    chatWindow.appendChild(msgDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey
            },
            body: JSON.stringify({ question: text, chapter: currentChapter })
        });

        if (response.status === 401) {
            localStorage.removeItem('gemini_api_key');
            apiKey = null;
            apiModal.classList.remove('hidden');
            contentDiv.innerHTML = "API key is invalid or missing. Please provide it.";
            contentDiv.classList.remove('blinking-cursor');
            return;
        }

        if (!response.ok) {
            const errData = await response.json();
            contentDiv.innerHTML = `Error: ${errData.detail || "Server error"}`;
            contentDiv.classList.remove('blinking-cursor');
            return;
        }

        // Setup the stream reader
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let accumulatedMessage = "";
        let finalSourceChunk = "";
        let done = false;
        
        const sseRegex = /data:\s*({.*})\s*/;

        while (!done) {
            const { value, done: readerDone } = await reader.read();
            done = readerDone;
            if (value) {
                const chunkStr = decoder.decode(value, { stream: !done });
                const messages = chunkStr.split('\n\n');
                
                for (let msg of messages) {
                    msg = msg.trim();
                    if (!msg) continue;
                    
                    const match = msg.match(sseRegex);
                    if (match && match[1]) {
                        try {
                            const dataObj = JSON.parse(match[1]);
                            if (dataObj.text !== undefined) {
                                accumulatedMessage += dataObj.text;
                                contentDiv.innerHTML = formatTextToHtml(accumulatedMessage);
                                chatWindow.scrollTop = chatWindow.scrollHeight;
                            }
                            if (dataObj.source_chunk !== undefined) {
                                finalSourceChunk = dataObj.source_chunk;
                            }
                        } catch(e) {
                            console.warn("Failed to parse SSE JSON block: ", match[1]);
                        }
                    }
                }
            }
        }
        
        contentDiv.classList.remove('blinking-cursor');
        
        if (finalSourceChunk) {
            const btn = document.createElement('button');
            btn.className = 'source-btn';
            btn.textContent = 'View Source';
            btn.onclick = () => showSource(encodeURIComponent(finalSourceChunk));
            msgDiv.appendChild(btn);
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }

    } catch (err) {
        contentDiv.classList.remove('blinking-cursor');
        contentDiv.innerHTML = `Network Error: ${err.message}`;
    }
}

function appendFullMessage(text, sender, sourceChunk = null) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${sender}-msg`;
    let innerHtml = `<div class="msg-content">${formatTextToHtml(text)}</div>`;
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
