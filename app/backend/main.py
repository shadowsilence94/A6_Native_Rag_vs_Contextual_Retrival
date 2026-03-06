import os
from fastapi import FastAPI, HTTPException, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
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

# Paths
VECTORSTORE_DIR = "../answer/contextual_faiss_index"

# Global state for embeddings/retriever
_embeddings = None
_vectorstore = None

def get_retriever():
    global _embeddings, _vectorstore
    
    if not os.path.exists(VECTORSTORE_DIR):
        raise HTTPException(
            status_code=500, 
            detail="Contextual Vectorstore not found! Please run the 02_naive_vs_contextual_rag.ipynb notebook first to build the index."
        )

    if _embeddings is None:
        _embeddings = HuggingFaceEmbeddings(model_name="BAAI/bge-small-en-v1.5")
    
    if _vectorstore is None:
        _vectorstore = FAISS.load_local(VECTORSTORE_DIR, _embeddings, allow_dangerous_deserialization=True)
        
    return _vectorstore.as_retriever(search_kwargs={"k": 3})

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest, x_api_key: Optional[str] = Header(None)):
    if not x_api_key:
        raise HTTPException(status_code=401, detail="API Key is missing.")
    
    try:
        retriever = get_retriever()
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load retriever: {str(e)}")
        
    try:
        # Initialize LLM with the provided key
        llm = ChatGoogleGenerativeAI(
            model="gemini-3.0-flash", 
            temperature=0, 
            google_api_key=x_api_key
        )
        
        # Retrieve context
        docs = retriever.invoke(req.question)
        if not docs:
            return {"answer": "No context found. Please ask a different question.", "source_chunk": ""}
            
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
        response = chain.invoke({"context": context, "question": req.question})
        
        return {
            "answer": response.content.strip(),
            "source_chunk": top_chunk
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount frontend
app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")
