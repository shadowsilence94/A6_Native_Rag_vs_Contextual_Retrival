# A6: Naive RAG vs Contextual Retrieval

This repository contains the implementation for Assignment 6: Naive RAG vs Contextual Retrieval.
The assignment is based on Chapter 10 ("Transformers and Pretrained Language Models") of the NLP textbook by Jurafsky & Martin.

## Deliverables Included

1. **Jupyter Notebooks**:
   - `01_data_preparation.ipynb`: Downloads the textbook chapter, cleans the text, extracts the content into chunks, and uses Gemini to automatically generate a dataset of 20 Question-Answer pairs.
   - `02_naive_vs_contextual_rag.ipynb`: Implements both the Naive RAG (using vector search on basic chunks) and Contextual Retrieval (where context is prepended to chunks using an LLM). Evaluates the 20 QA dataset and calculates ROUGE-1, ROUGE-2, and ROUGE-L scores using the generated answers. Includes evaluation visualizations.

2. **Web Application** (`app/` folder):
   - A minimalist, modern UI with an Apple Glassmorphism aesthetic.
   - Built with a FastAPI backend (`app/backend/main.py`) serving the RAG retrieval mechanism.
   - A custom HTML/CSS/JS frontend requesting your Gemini API Key dynamically on page load and displaying the RAG responses along with source chunks.

3. **answer/ folder**:
   - Generated comparison JSON dataset (`response-st-126010-chapter-10.json`).
   - Saved FAISS vector indices for retrieval.

## Setup and Run Instructions

### 1. Environment Setup

Create a virtual environment and install dependencies:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Run Notebook 1: Data Preparation

Open `01_data_preparation.ipynb` in your Jupyter environment.
When running the notebook, you will be prompted securely for your **Gemini API Key**. Do not hardcode it.
This will download the chapter, clean the chunks, and generate your 20 QA pairs inside the `answer/` folder.

### 3. Run Notebook 2: RAG Comparison

Open `02_naive_vs_contextual_rag.ipynb` in your Jupyter environment.
Provide your **Gemini API Key** when prompted. 
This notebook reads the QA pairs, builds the Contextual RAG vector stores, evaluates the model using ROUGE scores, and saves the final JSON layout and a bar chart comparison.

### 4. Start the Web Application

After running Notebook 2 (which builds the FAISS indexes), start the web application:

```bash
cd app
cd backend
uvicorn main:app --reload
```

Open [http://localhost:8000](http://localhost:8000) in your web browser. 
The Web App will pop up a window asking for your Gemini API key contextually for the session. Submit the key, then ask any question regarding Chapter 10!
