// ── Competency framework v1.0.0 (versioned data, NOT code logic) ──────────
// This file is the single source of truth for the role-based competency
// framework. The deterministic scoring service
// (server/src/services/competencyScoringService.ts) LOADS this data — it
// never hardcodes categories, thresholds, weights or role definitions.
// The same definitions are seeded into Postgres by
// infra/postgres/010_competency_framework.sql (generated from this file;
// keep the two in sync when a new version ships).
//
// Versioning rule: a new framework version is a NEW object/version string.
// Historical results store `frameworkVersion` + a snapshot of the settings
// used, so changing this file never rewrites an old result.

export type ProficiencyCategoryId = "L1" | "L2" | "L3" | "L4";

export interface ProficiencyCategory {
  id: ProficiencyCategoryId;
  label: string;
  /** Inclusive lower bound (0–100). */
  min: number;
  /** Inclusive upper bound (0–100). */
  max: number;
  description: string;
}

export type CompetencyDifficulty = "Foundation" | "Intermediate" | "Advanced";

export interface CompetencyDefinition {
  /** Stable, unique-within-role id, e.g. "be-api-design". */
  id: string;
  name: string;
  description: string;
  /** Skills this competency evidences (used for the recruiter breakdown). */
  skills: string[];
  difficulty: CompetencyDifficulty;
  /** Evidence types accepted for this competency. */
  evidenceTypes: string[];
  /** What kind of practical/coding task evidences this competency. */
  codingTaskMapping: string;
  /** What kind of interview question evidences this competency. */
  interviewQuestionMapping: string;
  /** Rubric text per proficiency category — what the level looks like. */
  rubric: Record<ProficiencyCategoryId, string>;
  /** Minimum number of distinct evidence items required to assess. */
  minEvidence: number;
  minEvidenceDescription: string;
}

export interface RoleCompetency extends CompetencyDefinition {
  /** Weight within the role, in percent. All weights of a role sum to 100. */
  weight: number;
}

export interface RoleFramework {
  roleId: string;
  roleName: string;
  competencies: RoleCompetency[];
}

export interface ComponentWeights {
  coding: number;
  interview: number;
  evidence: number;
}

export interface CompetencyFramework {
  version: string;
  name: string;
  /** Proficiency categories — the ONLY place thresholds live. */
  categories: ProficiencyCategory[];
  /** Overall score S = C*coding + I*interview + E*evidence. Must sum to 1. */
  componentWeights: ComponentWeights;
  /**
   * Practical-task minimum: an overall coding component below this blocks
   * Job Ready (L3) / Strong (L4) — result status becomes
   * "Practical Threshold Not Met" and the category is capped at L2.
   */
  practicalMinimumCodingScore: number;
  roles: RoleFramework[];
}

export const FRAMEWORK_VERSION = "v1.0.0";

export const PROFICIENCY_CATEGORIES: ProficiencyCategory[] = [
  {
    id: "L1",
    label: "Foundation",
    min: 0,
    max: 39,
    description:
      "Foundational awareness only. The candidate recalls basic concepts but cannot yet apply them reliably to a real task without guidance.",
  },
  {
    id: "L2",
    label: "Developing",
    min: 40,
    max: 59,
    description:
      "Developing ability. The candidate applies core concepts to familiar problems with some support, but work is inconsistent and needs review.",
  },
  {
    id: "L3",
    label: "Job Ready",
    min: 60,
    max: 79,
    description:
      "Job ready. The candidate independently delivers correct, working solutions to typical role tasks and explains their reasoning clearly.",
  },
  {
    id: "L4",
    label: "Strong",
    min: 80,
    max: 100,
    description:
      "Strong. The candidate delivers high-quality solutions, handles edge cases and trade-offs, and can teach or review others in this area.",
  },
];

export const COMPETENCY_FRAMEWORK_V1: CompetencyFramework = {
  version: FRAMEWORK_VERSION,
  name: "GroundTruth Role Competency Framework",
  categories: PROFICIENCY_CATEGORIES,
  componentWeights: { coding: 0.5, interview: 0.3, evidence: 0.2 },
  practicalMinimumCodingScore: 40,
  roles: [
    {
      roleId: "backend-developer",
      roleName: "Backend Developer",
      competencies: [
        {
          id: "be-api-design",
          name: "API Design & REST",
          description:
            "Designs clear, consistent REST APIs: resources, status codes, versioning, auth and error handling.",
          skills: ["REST APIs", "HTTP", "FastAPI", "Node.js", "Express.js", "JWT"],
          difficulty: "Intermediate",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Build a REST endpoint with correct status codes, validation and auth.",
          interviewQuestionMapping:
            "Design a REST API for a given resource; explain status codes and versioning.",
          rubric: {
            L1: "Names HTTP verbs but cannot design a coherent resource layout.",
            L2: "Designs a basic CRUD API with guidance; status codes and errors are inconsistent.",
            L3: "Designs a clean, versioned REST API with correct codes, validation and auth.",
            L4: "Designs a production-grade API covering pagination, idempotency, rate limits and trade-offs.",
          },
          weight: 25,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing API work.",
        },
        {
          id: "be-databases",
          name: "Databases & Data Modelling",
          description:
            "Models relational data, writes correct SQL, understands indexes, transactions and migrations.",
          skills: ["SQL", "PostgreSQL", "Database Design", "Indexing", "Migrations"],
          difficulty: "Intermediate",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Design a schema and write queries with joins, aggregates and an index.",
          interviewQuestionMapping:
            "Explain normalisation, indexing and transaction isolation for a sample schema.",
          rubric: {
            L1: "Writes only trivial single-table queries; no modelling vocabulary.",
            L2: "Writes basic joins; schema has obvious redundancy or missing constraints.",
            L3: "Designs a normalised schema, correct joins/aggregates, sensible indexes.",
            L4: "Reasons about query plans, locking, migrations and scaling trade-offs.",
          },
          weight: 25,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing database work.",
        },
        {
          id: "be-server-logic",
          name: "Server-Side Logic & OOP",
          description:
            "Writes clean server-side code: OOP/design patterns, error handling, logging and configuration.",
          skills: ["Python", "OOP", "Design Patterns", "Error Handling", "Logging"],
          difficulty: "Intermediate",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Implement a service layer with classes, error handling and tests.",
          interviewQuestionMapping:
            "Explain how you would structure a service and handle failures in it.",
          rubric: {
            L1: "Writes unstructured scripts; no separation of concerns.",
            L2: "Uses classes/functions but mixes concerns and misses error paths.",
            L3: "Clean layered code with proper errors, logging and config separation.",
            L4: "Applies patterns deliberately, defends the structure, anticipates failure modes.",
          },
          weight: 20,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing server code.",
        },
        {
          id: "be-testing",
          name: "Testing & Debugging",
          description:
            "Writes automated tests, debugs systematically and uses logs/metrics to find root causes.",
          skills: ["Pytest", "Unit Testing", "Debugging", "Logging"],
          difficulty: "Foundation",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Write unit tests for a service, including an edge case and a failure case.",
          interviewQuestionMapping:
            "Walk through how you would debug a failing endpoint in production.",
          rubric: {
            L1: "Tests only the happy path manually; debugging is guesswork.",
            L2: "Writes some unit tests; debugging follows a loose, ad-hoc trail.",
            L3: "Good unit-test coverage of edge cases; systematic reproduce-isolate-fix debugging.",
            L4: "Designs test strategy (unit/integration/contract) and debugs from metrics and traces.",
          },
          weight: 15,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing testing or debugging.",
        },
        {
          id: "be-system-design",
          name: "System Design & Scalability",
          description:
            "Reasons about scaling, caching, queues and failure modes of a backend system.",
          skills: ["System Design", "Caching", "Redis", "Queues", "Docker"],
          difficulty: "Advanced",
          evidenceTypes: ["project", "interview-answer"],
          codingTaskMapping:
            "Extend a service with caching and a background queue for a slow job.",
          interviewQuestionMapping:
            "Design a system that must handle 10x traffic; discuss caching, queues and failure.",
          rubric: {
            L1: "Cannot name scaling levers beyond 'bigger server'.",
            L2: "Names caching/queues but cannot place them correctly in a design.",
            L3: "Produces a sound design with caching, queues and stated trade-offs.",
            L4: "Designs for failure, consistency and cost; compares alternatives quantitatively.",
          },
          weight: 15,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one project and one interview answer showing system-design thinking.",
        },
      ],
    },
    {
      roleId: "full-stack-developer",
      roleName: "Full Stack Developer",
      competencies: [
        {
          id: "fs-frontend",
          name: "Frontend Fundamentals",
          description:
            "Builds responsive, accessible interfaces with HTML, CSS, JavaScript and a modern framework.",
          skills: ["HTML", "CSS", "JavaScript", "React", "Responsive Design"],
          difficulty: "Intermediate",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Build a responsive form page with validation and accessible markup.",
          interviewQuestionMapping:
            "Explain how you structure a React component and handle its state.",
          rubric: {
            L1: "Static markup only; no interactivity or responsive behaviour.",
            L2: "Working pages with basic state; layout breaks on small screens.",
            L3: "Responsive, accessible components with clean state handling.",
            L4: "Polished, performant UI with reusable component architecture.",
          },
          weight: 20,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing frontend work.",
        },
        {
          id: "fs-backend-apis",
          name: "Backend APIs",
          description:
            "Builds and secures server APIs that the frontend consumes, with validation and error handling.",
          skills: ["REST APIs", "FastAPI", "Node.js", "Express.js", "JWT", "SQL"],
          difficulty: "Intermediate",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Build a CRUD API with auth and validation consumed by a frontend page.",
          interviewQuestionMapping:
            "Explain how frontend and backend agree on contracts and handle errors.",
          rubric: {
            L1: "Cannot connect a frontend to an API without a worked example.",
            L2: "Basic endpoints work; auth and error handling are patchy.",
            L3: "Solid validated API with auth, consumed cleanly by the frontend.",
            L4: "Contract-first API design with versioning, pagination and typed clients.",
          },
          weight: 25,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing API work.",
        },
        {
          id: "fs-databases",
          name: "Databases & Persistence",
          description:
            "Persists application data correctly across SQL and document stores, with migrations.",
          skills: ["SQL", "PostgreSQL", "MongoDB", "Database Design", "Migrations"],
          difficulty: "Intermediate",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Model app data and implement create/read/update with correct queries.",
          interviewQuestionMapping:
            "Choose between SQL and a document store for a feature and justify it.",
          rubric: {
            L1: "Stores data in ad-hoc structures; no persistence design.",
            L2: "Basic persistence works; schema changes are manual and risky.",
            L3: "Clean models, correct queries, migrations for schema changes.",
            L4: "Reasons about consistency, indexing and migration safety across stores.",
          },
          weight: 20,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing persistence work.",
        },
        {
          id: "fs-devops",
          name: "DevOps & Deployment",
          description:
            "Ships a full-stack app: builds, environment config, containers and basic CI/CD.",
          skills: ["Docker", "CI/CD", "Git", "Deployment", "Vercel", "Render"],
          difficulty: "Intermediate",
          evidenceTypes: ["project", "interview-answer"],
          codingTaskMapping:
            "Containerise an app and wire a build/deploy pipeline for it.",
          interviewQuestionMapping:
            "Walk through taking a full-stack app from local to production.",
          rubric: {
            L1: "Runs only locally; deployment is unfamiliar.",
            L2: "Deploys manually with guidance; env config is fragile.",
            L3: "Reproducible containerised deploy with env config and CI checks.",
            L4: "Automated pipeline with previews, rollbacks and observability.",
          },
          weight: 15,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one project and one interview answer showing deployment work.",
        },
        {
          id: "fs-state-integration",
          name: "UI/UX Integration & State Management",
          description:
            "Connects UI state, API data and user flows end to end: loading, errors, forms and navigation.",
          skills: ["React", "State Management", "Forms", "UX", "TypeScript"],
          difficulty: "Intermediate",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Build a multi-step flow with loading, error and empty states.",
          interviewQuestionMapping:
            "Explain how you keep client state consistent with server data.",
          rubric: {
            L1: "Hardcodes data in the UI; no loading or error states.",
            L2: "Fetches data but state gets out of sync; error handling is thin.",
            L3: "Consistent state, proper loading/error/empty handling across flows.",
            L4: "Robust state architecture with caching, optimistic updates and recovery.",
          },
          weight: 20,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing end-to-end integration.",
        },
      ],
    },
    {
      roleId: "frontend-developer",
      roleName: "Frontend Developer",
      competencies: [
        {
          id: "fe-html-css",
          name: "HTML, CSS & Responsive Design",
          description:
            "Writes semantic HTML and maintainable CSS; layouts work across screen sizes.",
          skills: ["HTML", "CSS", "Responsive Design", "Flexbox", "Grid"],
          difficulty: "Foundation",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Recreate a responsive layout from a reference at three widths.",
          interviewQuestionMapping:
            "Explain semantic HTML choices and how a layout adapts to mobile.",
          rubric: {
            L1: "Markup with divs only; layout breaks outside one width.",
            L2: "Basic responsive layout; semantics and maintainability are weak.",
            L3: "Semantic, responsive, maintainable CSS across widths.",
            L4: "Design-system-grade CSS: tokens, accessibility, cross-browser care.",
          },
          weight: 25,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing layout work.",
        },
        {
          id: "fe-js-ts",
          name: "JavaScript & TypeScript",
          description:
            "Writes correct modern JavaScript/TypeScript: async code, types, DOM and browser APIs.",
          skills: ["JavaScript", "TypeScript", "Async/Await", "DOM"],
          difficulty: "Intermediate",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Implement async data fetching with error handling and typed models.",
          interviewQuestionMapping:
            "Explain promises, the event loop and when TypeScript types help.",
          rubric: {
            L1: "Writes only simple synchronous scripts; async code fails.",
            L2: "Async code works for the happy path; types are mostly 'any'.",
            L3: "Correct async flows with typed models and handled errors.",
            L4: "Idiomatic, well-typed code; explains event loop, closures and edge cases.",
          },
          weight: 25,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing JavaScript/TypeScript work.",
        },
        {
          id: "fe-react",
          name: "React & State Management",
          description:
            "Builds React apps with components, hooks and predictable state.",
          skills: ["React", "Hooks", "State Management", "Next.js"],
          difficulty: "Intermediate",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Build a small React feature with hooks, lifted state and a list.",
          interviewQuestionMapping:
            "Explain hooks, re-renders and how you organise component state.",
          rubric: {
            L1: "Copies component examples; state behaviour is unpredictable.",
            L2: "Working components; prop drilling and needless re-renders.",
            L3: "Clean components, correct hooks, well-placed state.",
            L4: "Reusable component architecture with performance-aware state design.",
          },
          weight: 25,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing React work.",
        },
        {
          id: "fe-perf-a11y",
          name: "Web Performance & Accessibility",
          description:
            "Ships fast, accessible pages: Core Web Vitals, keyboard/ARIA support, semantic structure.",
          skills: ["Web Performance", "Accessibility", "ARIA", "SEO Basics"],
          difficulty: "Intermediate",
          evidenceTypes: ["project", "interview-answer"],
          codingTaskMapping:
            "Optimise a slow page and fix its accessibility issues.",
          interviewQuestionMapping:
            "How do you measure performance and make a page accessible?",
          rubric: {
            L1: "Unaware of performance or accessibility concerns.",
            L2: "Knows the terms; fixes are superficial or break other things.",
            L3: "Measures, fixes real perf and a11y issues, verifies with tools.",
            L4: "Builds perf/a11y budgets into the workflow and prevents regressions.",
          },
          weight: 15,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one project and one interview answer showing performance or accessibility work.",
        },
        {
          id: "fe-testing-tooling",
          name: "Testing & Frontend Tooling",
          description:
            "Tests UI behaviour and uses modern build tooling confidently.",
          skills: ["Testing", "Vitest", "Build Tools", "Git", "Linting"],
          difficulty: "Foundation",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Write component tests for rendering, interaction and an error state.",
          interviewQuestionMapping:
            "What do you test in a UI, and how does your build pipeline work?",
          rubric: {
            L1: "No tests; tooling is a black box.",
            L2: "A few shallow tests; build errors are fixed by trial and error.",
            L3: "Meaningful component tests; understands the build/lint setup.",
            L4: "Test strategy across unit/integration/E2E plus tuned tooling.",
          },
          weight: 10,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing testing or tooling.",
        },
      ],
    },
    {
      roleId: "python-developer",
      roleName: "Python Developer",
      competencies: [
        {
          id: "py-core",
          name: "Python Core & OOP",
          description:
            "Writes idiomatic Python: data structures, OOP, decorators, context managers and the stdlib.",
          skills: ["Python", "OOP", "Data Structures", "Stdlib"],
          difficulty: "Intermediate",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Implement a class-based solution using stdlib features and clean APIs.",
          interviewQuestionMapping:
            "Explain Python OOP, dunder methods and when to use a decorator.",
          rubric: {
            L1: "Writes Python like pseudocode; no idioms or OOP.",
            L2: "Working code; classes are thin wrappers, idioms are missed.",
            L3: "Idiomatic Python with clean OOP and appropriate stdlib use.",
            L4: "Expert-level idioms, metaprogramming awareness, library-grade code.",
          },
          weight: 30,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing Python code.",
        },
        {
          id: "py-dsa",
          name: "Data Structures & Algorithms",
          description:
            "Chooses the right data structure and algorithm and analyses time/space complexity.",
          skills: ["Data Structures", "Algorithms", "Complexity Analysis"],
          difficulty: "Intermediate",
          evidenceTypes: ["coding-task", "interview-answer"],
          codingTaskMapping:
            "Solve an algorithmic task with stated complexity and edge cases.",
          interviewQuestionMapping:
            "Compare data structures for a use case and analyse complexity.",
          rubric: {
            L1: "Brute force only; cannot state complexity.",
            L2: "Solves easy problems; complexity analysis is shaky.",
            L3: "Correct, efficient solutions with sound complexity reasoning.",
            L4: "Optimal solutions, trade-off analysis, adapts known patterns to new problems.",
          },
          weight: 20,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one interview answer showing algorithmic work.",
        },
        {
          id: "py-frameworks",
          name: "Libraries & Frameworks",
          description:
            "Uses Python libraries and frameworks (web, data, automation) productively and reads their docs.",
          skills: ["FastAPI", "Pandas", "NumPy", "Requests", "SQLAlchemy"],
          difficulty: "Intermediate",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Build a small FastAPI service using a third-party library correctly.",
          interviewQuestionMapping:
            "How do you pick and learn a new Python library for a task?",
          rubric: {
            L1: "Stuck without a tutorial for any library.",
            L2: "Uses one framework for routine tasks; docs are skimmed.",
            L3: "Productive across several libraries; reads docs and source when stuck.",
            L4: "Evaluates libraries critically, contributes fixes, designs around them.",
          },
          weight: 20,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing library use.",
        },
        {
          id: "py-testing",
          name: "Testing & Debugging in Python",
          description:
            "Writes pytest tests, debugs with tools and handles errors cleanly.",
          skills: ["Pytest", "Debugging", "Error Handling", "Logging"],
          difficulty: "Foundation",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Write pytest tests including fixtures and a mocked dependency.",
          interviewQuestionMapping:
            "Walk through debugging a failing Python program step by step.",
          rubric: {
            L1: "Prints to debug; no tests.",
            L2: "Some tests; debugging is mostly print statements.",
            L3: "Good pytest coverage; uses debugger and logging systematically.",
            L4: "Test strategy plus profiling; prevents whole classes of bugs.",
          },
          weight: 15,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing testing or debugging.",
        },
        {
          id: "py-scripting",
          name: "Scripting & Automation",
          description:
            "Automates real work with scripts: files, CLI tools, APIs and scheduled jobs.",
          skills: ["Scripting", "CLI", "Automation", "APIs", "Cron"],
          difficulty: "Foundation",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Write a CLI script that reads files, calls an API and writes a report.",
          interviewQuestionMapping:
            "Describe a task you automated and how the script handles failures.",
          rubric: {
            L1: "Scripts only work once, on one machine, for one input.",
            L2: "Working scripts; error handling and configurability are thin.",
            L3: "Robust, reusable scripts with args, logging and error handling.",
            L4: "Production-grade automation: idempotent, tested, monitored.",
          },
          weight: 15,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing automation.",
        },
      ],
    },
    {
      roleId: "ai-ml-engineer",
      roleName: "AI/ML Engineer",
      competencies: [
        {
          id: "ml-fundamentals",
          name: "ML Fundamentals",
          description:
            "Understands supervised/unsupervised learning, bias-variance, overfitting and evaluation basics.",
          skills: ["Machine Learning", "Scikit-learn", "Statistics", "Model Evaluation"],
          difficulty: "Intermediate",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Train and compare two models on a dataset and explain the choice.",
          interviewQuestionMapping:
            "Explain overfitting, bias-variance and how you would detect them.",
          rubric: {
            L1: "Names algorithms but cannot explain when to use them.",
            L2: "Trains a model from a tutorial; evaluation is a single accuracy number.",
            L3: "Compares models with proper splits and metrics; explains trade-offs.",
            L4: "Designs experiments, diagnoses failure modes, justifies every choice.",
          },
          weight: 25,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing ML work.",
        },
        {
          id: "ml-data-prep",
          name: "Data Preprocessing & Feature Engineering",
          description:
            "Cleans messy data, handles missing values and builds useful features.",
          skills: ["Pandas", "NumPy", "Data Cleaning", "Feature Engineering"],
          difficulty: "Intermediate",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Clean a messy dataset and engineer features for a model.",
          interviewQuestionMapping:
            "How do you handle missing data and leakage in a pipeline?",
          rubric: {
            L1: "Uses data as given; no cleaning or feature thought.",
            L2: "Basic cleaning; features are raw columns.",
            L3: "Sound cleaning, leakage-aware splits, meaningful features.",
            L4: "Builds reusable, validated feature pipelines with drift checks.",
          },
          weight: 20,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing data preparation.",
        },
        {
          id: "ml-training-eval",
          name: "Model Training & Evaluation",
          description:
            "Trains, tunes and evaluates models with the right metrics, including imbalanced data.",
          skills: ["Model Training", "Hyperparameter Tuning", "ROC-AUC", "Cross-Validation"],
          difficulty: "Advanced",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Tune a model with cross-validation and report the right metrics.",
          interviewQuestionMapping:
            "Which metric would you use for an imbalanced classifier, and why?",
          rubric: {
            L1: "Reports accuracy only, on the training set.",
            L2: "Uses a test split; metric choice is unexamined.",
            L3: "Proper CV, tuned hyperparameters, metrics matched to the problem.",
            L4: "Rigorous evaluation including calibration, error analysis and fairness checks.",
          },
          weight: 25,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing training and evaluation.",
        },
        {
          id: "ml-dl-llm",
          name: "Deep Learning & LLMs",
          description:
            "Uses neural networks and LLM APIs/RAG: prompting, retrieval, embeddings and failure modes.",
          skills: ["Deep Learning", "LLM APIs", "RAG", "Prompt Engineering", "Embeddings"],
          difficulty: "Advanced",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Build a small RAG pipeline over documents and evaluate its answers.",
          interviewQuestionMapping:
            "Explain embeddings, retrieval and the failure modes of LLM apps.",
          rubric: {
            L1: "Has prompted a chatbot; no understanding of retrieval or limits.",
            L2: "Calls an LLM API; RAG is a black box.",
            L3: "Working RAG/LLM feature with chunking, retrieval and evaluation.",
            L4: "Designs LLM systems with guardrails, cost control and measured quality.",
          },
          weight: 15,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing DL/LLM work.",
        },
        {
          id: "ml-mlops",
          name: "MLOps & Deployment",
          description:
            "Ships models as services: versioning, APIs, monitoring and reproducibility.",
          skills: ["MLOps", "FastAPI", "Docker", "Model Serving", "Monitoring"],
          difficulty: "Advanced",
          evidenceTypes: ["project", "interview-answer"],
          codingTaskMapping:
            "Serve a trained model behind an API with input validation and logging.",
          interviewQuestionMapping:
            "How do you version, deploy and monitor a model in production?",
          rubric: {
            L1: "Models live in notebooks only.",
            L2: "A one-off serving script; no versioning or monitoring.",
            L3: "Versioned model behind a validated API with basic monitoring.",
            L4: "Full lifecycle: CI for models, drift detection, rollback plan.",
          },
          weight: 15,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one project and one interview answer showing model deployment.",
        },
      ],
    },
    {
      roleId: "data-scientist",
      roleName: "Data Scientist",
      competencies: [
        {
          id: "ds-stats",
          name: "Statistics & Probability",
          description:
            "Applies distributions, hypothesis testing, confidence intervals and experimental design.",
          skills: ["Statistics", "Probability", "Hypothesis Testing", "A/B Testing"],
          difficulty: "Intermediate",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Analyse an experiment: test a hypothesis and report uncertainty.",
          interviewQuestionMapping:
            "Explain p-values, confidence intervals and when an A/B test is valid.",
          rubric: {
            L1: "Quotes averages only; no notion of uncertainty.",
            L2: "Runs a t-test from a recipe; interpretation is shaky.",
            L3: "Correct tests, intervals and experiment design for the question.",
            L4: "Designs rigorous experiments; spots bias, Simpson's paradox, peeking.",
          },
          weight: 25,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing statistical work.",
        },
        {
          id: "ds-analysis-viz",
          name: "Data Analysis & Visualisation",
          description:
            "Explores data, finds patterns and communicates them with clear visualisations.",
          skills: ["Pandas", "Data Analysis", "Visualisation", "Matplotlib", "EDA"],
          difficulty: "Intermediate",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Perform EDA on a dataset and present findings with charts.",
          interviewQuestionMapping:
            "Walk through how you would explore an unfamiliar dataset.",
          rubric: {
            L1: "Prints head() and a few means; no narrative.",
            L2: "Some plots; findings are descriptive, not insightful.",
            L3: "Structured EDA with clear charts that answer the business question.",
            L4: "Insightful analysis with honest caveats and decision-ready visuals.",
          },
          weight: 20,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing analysis.",
        },
        {
          id: "ds-ml-modelling",
          name: "ML Modelling",
          description:
            "Builds predictive models end to end and interprets them honestly.",
          skills: ["Machine Learning", "Scikit-learn", "Regression", "Classification"],
          difficulty: "Advanced",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Build a regression/classification model and interpret its results.",
          interviewQuestionMapping:
            "How do you choose a model and know whether to trust it?",
          rubric: {
            L1: "Fits a model and reports one number.",
            L2: "Basic model works; feature and metric choices are unexamined.",
            L3: "Sound modelling with validation, interpretation and limitations stated.",
            L4: "Rigorous modelling with error analysis, calibration and business translation.",
          },
          weight: 25,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing modelling.",
        },
        {
          id: "ds-sql-wrangling",
          name: "SQL & Data Wrangling",
          description:
            "Gets data out of databases and shapes it with SQL and Python.",
          skills: ["SQL", "PostgreSQL", "Data Wrangling", "Pandas"],
          difficulty: "Intermediate",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Write SQL to answer business questions, including window functions.",
          interviewQuestionMapping:
            "Explain how you would get and clean data for an analysis.",
          rubric: {
            L1: "SELECT * only; wrangling is manual spreadsheet work.",
            L2: "Basic joins and filters; complex questions stall.",
            L3: "Confident SQL (joins, windows, CTEs) and reproducible wrangling.",
            L4: "Efficient, well-structured queries on large data; pipelines are reusable.",
          },
          weight: 15,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing SQL/wrangling.",
        },
        {
          id: "ds-communication",
          name: "Communication & Storytelling",
          description:
            "Turns analysis into decisions: clear narratives, honest caveats, stakeholder-ready reporting.",
          skills: ["Communication", "Storytelling", "Reporting", "Stakeholder Management"],
          difficulty: "Foundation",
          evidenceTypes: ["project", "interview-answer"],
          codingTaskMapping:
            "Write a one-page summary of an analysis for a non-technical stakeholder.",
          interviewQuestionMapping:
            "Present an analysis result and defend its limitations.",
          rubric: {
            L1: "Shares raw output; no story or recommendation.",
            L2: "A narrative exists but buries the finding or hides caveats.",
            L3: "Clear story, key finding first, caveats and next steps stated.",
            L4: "Compelling, decision-ready communication that changes what happens next.",
          },
          weight: 15,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one project and one interview answer showing communication of results.",
        },
      ],
    },
    {
      roleId: "software-development-engineer",
      roleName: "Software Development Engineer",
      competencies: [
        {
          id: "sde-dsa",
          name: "Data Structures & Algorithms",
          description:
            "Solves algorithmic problems efficiently and analyses complexity rigorously.",
          skills: ["Data Structures", "Algorithms", "Complexity Analysis", "Problem Solving"],
          difficulty: "Advanced",
          evidenceTypes: ["coding-task", "interview-answer"],
          codingTaskMapping:
            "Solve medium/hard algorithmic tasks under time limits with edge cases.",
          interviewQuestionMapping:
            "Solve a problem on the spot and analyse its complexity.",
          rubric: {
            L1: "Brute force only; cannot analyse complexity.",
            L2: "Solves easy problems; struggles with optimisation.",
            L3: "Efficient solutions with correct complexity analysis.",
            L4: "Optimal solutions with trade-off discussion and pattern transfer.",
          },
          weight: 30,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one interview answer showing algorithmic work.",
        },
        {
          id: "sde-system-design",
          name: "System Design",
          description:
            "Designs large systems: APIs, storage, scaling, consistency and failure handling.",
          skills: ["System Design", "Scalability", "Distributed Systems", "Caching"],
          difficulty: "Advanced",
          evidenceTypes: ["project", "interview-answer"],
          codingTaskMapping:
            "Design a scalable service and defend storage and consistency choices.",
          interviewQuestionMapping:
            "Design a system for a stated scale; discuss bottlenecks and trade-offs.",
          rubric: {
            L1: "Cannot decompose a system beyond one server.",
            L2: "Names components but the design has gaps and no numbers.",
            L3: "Coherent design with capacity reasoning and stated trade-offs.",
            L4: "Rigorous design with failure modes, consistency and cost analysis.",
          },
          weight: 20,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one project and one interview answer showing system design.",
        },
        {
          id: "sde-oop-patterns",
          name: "OOP & Design Patterns",
          description:
            "Writes maintainable object-oriented code and applies patterns where they genuinely help.",
          skills: ["OOP", "Design Patterns", "Clean Code", "SOLID"],
          difficulty: "Intermediate",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Refactor a tangled module using appropriate patterns.",
          interviewQuestionMapping:
            "Explain SOLID and a pattern you have actually used, with its cost.",
          rubric: {
            L1: "Procedural code in classes; patterns are buzzwords.",
            L2: "Uses some patterns; often over-applied or misplaced.",
            L3: "Clean OOP; patterns used deliberately and sparingly.",
            L4: "Designs evolvable architectures; teaches pattern trade-offs.",
          },
          weight: 20,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing design work.",
        },
        {
          id: "sde-testing-quality",
          name: "Testing & Code Quality",
          description:
            "Keeps code correct and reviewable: tests, reviews, static analysis and clean practices.",
          skills: ["Testing", "Code Review", "Clean Code", "CI"],
          difficulty: "Intermediate",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Add tests and fix review findings on a provided codebase.",
          interviewQuestionMapping:
            "What makes code reviewable, and what do you look for in a review?",
          rubric: {
            L1: "No tests; reviews are rubber stamps.",
            L2: "Some tests; review comments are mostly style.",
            L3: "Good tests and substantive, kind reviews; quality gates in CI.",
            L4: "Raises the team's bar: test strategy, review culture, measurable quality.",
          },
          weight: 15,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing testing or review work.",
        },
        {
          id: "sde-debugging",
          name: "Problem Solving & Debugging",
          description:
            "Breaks down ambiguous problems and debugs production issues systematically.",
          skills: ["Problem Solving", "Debugging", "Troubleshooting", "Incident Response"],
          difficulty: "Intermediate",
          evidenceTypes: ["coding-task", "project", "interview-answer"],
          codingTaskMapping:
            "Debug a failing service from logs and a reproduction case.",
          interviewQuestionMapping:
            "Walk through a hard bug you solved and how you found it.",
          rubric: {
            L1: "Guesses at fixes; cannot reproduce reliably.",
            L2: "Finds simple bugs; complex ones need help.",
            L3: "Systematic debugging: reproduce, isolate, verify the fix.",
            L4: "Diagnoses the hardest production issues and prevents recurrence.",
          },
          weight: 15,
          minEvidence: 2,
          minEvidenceDescription:
            "At least 2 distinct items: one coding task and one project or interview answer showing debugging.",
        },
      ],
    },
  ],
};
