import os
import json
import random
import glob
from fastapi import FastAPI, HTTPException, Request, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from langchain_community.vectorstores import FAISS
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import PromptTemplate

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request Models
class ChatRequest(BaseModel):
    question: str
    chapter: str = "10" # Default to 10 if not provided

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
ANSWER_DIR = os.path.join(BASE_DIR, "answer")

# Global state for embeddings/retriever to cache per-chapter
_embeddings = None
_vectorstores = {}

def get_retriever(chapter: str):
    global _embeddings, _vectorstores
    
    chapter_dir = os.path.join(ANSWER_DIR, f"chapter_{chapter}")
    vectorstore_dir = os.path.join(chapter_dir, "contextual_faiss_index")
    
    if not os.path.exists(vectorstore_dir):
        raise HTTPException(
            status_code=500, 
            detail=f"Contextual Vectorstore not found for chapter {chapter}! Please generate the index and place it in 'answer/chapter_{chapter}/contextual_faiss_index'."
        )

    if _embeddings is None:
        _embeddings = HuggingFaceEmbeddings(model_name="BAAI/bge-small-en-v1.5")
    
    # Cache vectorstores in memory so we don't reload FAISS on every request
    if chapter not in _vectorstores:
        _vectorstores[chapter] = FAISS.load_local(vectorstore_dir, _embeddings, allow_dangerous_deserialization=True)
        
    return _vectorstores[chapter].as_retriever(search_kwargs={"k": 3})

@app.get("/api/chapters")
async def get_chapters():
    """Scan the answer/ directory for any valid chapter_X folders."""
    if not os.path.exists(ANSWER_DIR):
        return {"chapters": []}
    
    chapters = []
    for item in os.listdir(ANSWER_DIR):
        if item.startswith("chapter_") and os.path.isdir(os.path.join(ANSWER_DIR, item)):
            chapter_num = item.replace("chapter_", "")
            chapters.append(chapter_num)
            
    # Sort numerically
    try:
        chapters.sort(key=int)
    except:
        chapters.sort()
        
    return {"chapters": chapters}


@app.get("/api/suggestions")
async def get_suggestions(chapter: str = Query("10")):
    try:
        chapter_dir = os.path.join(ANSWER_DIR, f"chapter_{chapter}")
        
        # Find any JSON file in the chapter directory to extract QA pairs
        json_files = glob.glob(os.path.join(chapter_dir, "*.json"))
        
        if not json_files:
            return {"suggestions": [
                f"What is discussed in chapter {chapter}?",
                "Can you summarize the main points?",
                "What are the key concepts?"
            ]}
            
        dataset_path = json_files[0]
            
        with open(dataset_path, "r") as f:
            data = json.load(f)
            
        # Extract all questions
        questions = [item["question"] for item in data if "question" in item]
        
        # Select 3 random questions
        if len(questions) >= 3:
            suggestions = random.sample(questions, 3)
        else:
            suggestions = questions
            
        return {"suggestions": suggestions}
    except Exception as e:
        print(f"Error loading suggestions for chapter {chapter}: {e}")
        return {"suggestions": [
            f"What is discussed in chapter {chapter}?",
            "Can you summarize the main points?"
        ]}

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest, x_api_key: Optional[str] = Header(None)):
    if not x_api_key:
        raise HTTPException(status_code=401, detail="API Key is missing.")
    
    try:
        retriever = get_retriever(req.chapter)
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load retriever: {str(e)}")
        
    try:
        # Initialize LLM with the provided key and streaming explicitly enabled
        llm = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash", 
            temperature=0, 
            google_api_key=x_api_key,
            streaming=True
        )
        
        # Retrieve context
        docs = retriever.invoke(req.question)
        if not docs:
            # Manually yield error as an event stream if context missing
            async def no_context_stream():
                yield f'data: {json.dumps({"text": "No context found. Please ask a different question."})}\n\n'
                yield f'data: {json.dumps({"source_chunk": ""})}\n\n'
            return StreamingResponse(no_context_stream(), media_type="text/event-stream")
            
        context = "\n---\n".join([d.page_content for d in docs])
        top_chunk = docs[0].page_content # Return the primary chunk for citation as required
        
        # Generate Answer
        qa_prompt = PromptTemplate.from_template(
            "You are an expert NLP assistant.\n"
            "Answer the user's question clearly and precisely using ONLY the provided context.\n"
            "If the context does not contain the answer, say 'I don't know'.\n\n"
            "Context:\n{context}\n\n"
            "Question: {question}\n\n"
            "Answer:"
        )
        
        chain = qa_prompt | llm

        async def generate_chat_events():
            # Astream over the chunks as they are generated by Gemini
            async for chunk in chain.astream({"context": context, "question": req.question}):
                if chunk.content:
                    # Yield incremental text chunks
                    yield f'data: {json.dumps({"text": chunk.content})}\n\n'
            
            # After generation succeeds, finally yield the source chunk
            yield f'data: {json.dumps({"source_chunk": top_chunk})}\n\n'
            
        return StreamingResponse(generate_chat_events(), media_type="text/event-stream")
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount frontend
app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")
