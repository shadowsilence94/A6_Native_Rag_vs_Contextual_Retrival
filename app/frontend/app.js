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

// Helper function to format basic markdown to HTML dynamically
function formatTextToHtml(text) {
    return text.replace(/\n/g, '<br />'); // Only replace basic newlines for streams
}

async function sendMessage() {
    const text = userInput.value.trim();
    if (!text || !apiKey) return;

    // Reset input
    userInput.value = '';
    userInput.style.height = 'auto';

    // Hide suggestions once a conversation starts
    suggestionsContainer.classList.add('hidden');

    // Add user message to UI
    appendFullMessage(text, 'user');

    // Add empty assistant message container waiting for stream
    const msgDivId = 'msg-' + Date.now();
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message system-msg';
    msgDiv.id = msgDivId;
    
    // Set up the inner container where stream text will go
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
            body: JSON.stringify({ question: text })
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
        
        // This regex extracts valid JSON payloads prefixed with 'data: '
        const sseRegex = /data:\s*({.*})\s*/;

        while (!done) {
            const { value, done: readerDone } = await reader.read();
            done = readerDone;
            if (value) {
                // Decode binary chunk to string
                const chunkStr = decoder.decode(value, { stream: !done });
                
                // An SSE chunk from the server might contain multiple lines or exact JSON snippets.
                // We split by standard SSE message boundaries (double newlines)
                const messages = chunkStr.split('\n\n');
                
                for (let msg of messages) {
                    msg = msg.trim();
                    if (!msg) continue;
                    
                    const match = msg.match(sseRegex);
                    if (match && match[1]) {
                        try {
                            const dataObj = JSON.parse(match[1]);
                            
                            // 1. Text chunks generated by the LLM
                            if (dataObj.text !== undefined) {
                                accumulatedMessage += dataObj.text;
                                // Continuously render formatted HTML back to the DOM
                                contentDiv.innerHTML = formatTextToHtml(accumulatedMessage);
                                chatWindow.scrollTop = chatWindow.scrollHeight;
                            }
                            
                            // 2. The source chunk emitted exactly once at the end of the stream
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
        
        // Final cleanup after successful stream
        contentDiv.classList.remove('blinking-cursor');
        
        // Append the "View Source" button if context was provided
        if (finalSourceChunk) {
            const btn = document.createElement('button');
            btn.className = 'source-btn';
            btn.textContent = 'View Source';
            // Use arrow wrapper so it executes with the proper context at click
            btn.onclick = () => showSource(encodeURIComponent(finalSourceChunk));
            msgDiv.appendChild(btn);
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }

    } catch (err) {
        contentDiv.classList.remove('blinking-cursor');
        contentDiv.innerHTML = `Network Error: ${err.message}`;
    }
}

// Helper to render one-off non-streaming messages (like User input or flat errors)
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
