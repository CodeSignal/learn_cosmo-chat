# **PRD: ChatCPT (Cosmo Prompt Tutor)**

## **1. Overview**

**Product Name:** ChatCPT (Chat Cosmo’s Prompt Tutor)
**Purpose:**
A lightweight, hands-on chat interface designed to teach users how to effectively interact with AI chat tools (e.g., ChatGPT, Claude, Gemini) through guided practice.

**Core Concept:**
Provide a simplified, familiar chat interface where users can practice prompting, iterate on responses, and submit their best attempt for evaluation.

---

## **2. Goals & Objectives**

### **Primary Goals**

* Teach effective prompt engineering through hands-on interaction
* Simulate real-world AI chat interfaces in a controlled learning environment
* Enable iterative learning (multiple attempts, refinement)
* Capture user interactions for grading and evaluation

### **Non-Goals**

* Not a full-featured AI chat product
* No long-term conversation persistence across sessions
* No complex model configuration exposed to learners
* No built-in feedback system (handled by external subsystem)

---

## **3. Target Users**

* Learners practicing AI prompting skills
* Students in structured courses (technical, writing, soft skills)
* Users with little to moderate experience using AI chat tools

---

## **4. User Experience (UX)**

### **4.1 Entry State (Landing View)**

* User opens an exercise
* Sees:

  * A clean chat interface
  * Optional pre-populated prompt (from config)
  * Welcome/system-generated context (Cosmo tone)

---

### **4.2 Chat Interface**

#### **Core Components**

* **Chat History Panel**

  * Scrollable
  * Displays full conversation (user + AI)
* **Input Box**

  * Editable text area
  * Supports prefilled text
* **Send Button**
* **Optional Controls**

  * Upload Document (PDF, etc.)
  * Generate Image (if enabled)

---

### **4.3 Iteration Model**

* Users can:

  * Submit multiple prompts
  * Refine and retry as many times as desired
* Each interaction is appended to chat history

---

### **4.4 Submission Model**

* Default:

  * Most recent interaction = selected submission
* User can:

  * Select any previous attempt as “final submission”
* UI Element:

  * “Select for Submission” button on each attempt

---

### **4.5 Session Behavior**

* Each exercise = new session
* No cross-session memory
* Session persists temporarily for evaluation

---

## **5. Features**

### **5.1 Core Features**

#### **Chat Interaction**

* Real-time prompt → response flow
* Streaming responses (optional)

#### **Prompt History**

* Full session history visible
* No deletion/editing of past messages (MVP assumption)

#### **Submission Selection**

* Ability to mark a specific interaction as final

---

### **5.2 Intermediate Features**

#### **Document Upload**

* Upload files (e.g., PDF)
* Use case: summarization, extraction tasks

#### **Image Generation**

* Allow prompt-based image creation (optional per exercise)

---

### **5.3 Authoring Configuration**

Each exercise is driven by a configuration file.

#### **Config File (JSON/YAML) Includes:**

```json
{
  "system_prompt": "...",
  "initial_prompt": "...",
  "model": "gpt-4.x",
  "temperature": 0.7,
  "max_tokens": 1000,
  "tools": {
    "document_upload": true,
    "image_generation": false
  }
}
```

#### **Config Capabilities**

* Define system prompt (Cosmo behavior)
* Prepopulate user input
* Control model parameters
* Enable/disable tools

---

## **6. Backend Architecture**

### **6.1 Overview**

The system calls **Amazon Bedrock** (`ConverseStream`) directly for all LLM interactions.

**Frontend → Backend → Octopus → LLM → Response → Frontend**

---

### **6.2 Responsibilities**

#### **Frontend**

* Render chat UI
* Manage session state locally
* Handle user interactions
* Send prompts to backend

#### **Backend (Thin Layer)**

* Route requests to Octopus
* Store session data (JSON)
* Return responses

#### **Octopus (Core Orchestrator)**

* Manage:

  * System prompts
  * Model execution
  * Tool usage (documents/images)
  * Session context
* Execute agent workflows

---

### **6.3 Agent Design (Octopus)**

#### **Cosmo Tutor Agent**

Defined declaratively with:

* **System Prompt**
* **Model Config**
* **Tool Definitions**
* **Workflow**

#### **Workflow Example**

1. Receive user prompt
2. Apply system prompt
3. Invoke LLM
4. Return response
5. Log interaction

---

### **6.4 Session Persistence**

* No database required
* Store session data as JSON:

```json
{
  "session_id": "...",
  "messages": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ],
  "selected_submission": "message_id"
}
```

* Used for:

  * Grading
  * Evaluation
  * Replay

---

## **7. System Prompt (Cosmo)**

### **Base Prompt**

```
You are Cosmo, a helpful and friendly AI tutor.

Your goal is to help users practice interacting effectively with AI systems.

Guidelines:
- Be clear, concise, and conversational
- Break down explanations step-by-step when needed
- Encourage good prompting habits through example responses
- Stay supportive and engaging

Guardrails:
- Do not generate harmful, unsafe, or inappropriate content
- Do not provide medical, legal, or sensitive advice
- If a request is inappropriate, politely refuse and redirect
- Stay focused on educational and task-oriented interactions

Always maintain a positive learning experience.
```

---

## **8. Guardrails & Safety**

### **Content Guardrails**

* Block:

  * Harmful or unsafe content
  * Illegal instructions
  * Sensitive advice (medical/legal)
* Fallback:

  * Friendly refusal + redirection

### **System Constraints**

* Limit prompt length (configurable)
* Rate limiting (optional)
* Tool access controlled via config

---

## **9. Data & Evaluation**

### **Captured Data**

* Full chat transcript
* All attempts
* Selected submission

### **Storage**

* JSON file per session

### **Used By**

* External grading subsystem
* Analytics (future)

---

## **10. Technical Constraints**

* No database (MVP)
* Stateless between sessions
* Lightweight frontend
* Backend primarily acts as proxy/orchestrator

---

## **11. Future Enhancements (Out of Scope for MVP)**

* Inline feedback during chat
* Multi-session history
* Advanced prompt scoring visualization
* Collaborative or instructor view
* Real-time coaching hints

---

## **12. Success Metrics**

* Completion rate of exercises
* Number of iterations per user
* Quality improvement between attempts (via grading system)
* Engagement time per session

---

If you want, I can next:

* Turn this into a **schema + API spec**
* Generate a **frontend component architecture (React)**
* Or create an **Octopus agent config template** ready to drop in

Just say the word 👍
