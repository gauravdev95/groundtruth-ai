-- 010_competency_framework.sql — Phase B: versioned role-based competency
-- framework (v1.0.0) + historical competency results.
--
-- Tables:
--   competency_frameworks       one row per framework version; categories,
--                               component weights (C/I/E) and the practical
--                               minimum live here as data, never in code.
--   competencies                one row per competency definition (code,
--                               rubric, mappings, minimum evidence).
--   role_competency_mappings    which competencies a role uses and at what
--                               weight (weights per role sum to 100).
--   competency_results          persisted scoring results; each row records
--                               the framework_version used, so a version
--                               change never rewrites a historical result.
-- Idempotent by convention: CREATE TABLE/INDEX IF NOT EXISTS and every seed
-- INSERT ... ON CONFLICT DO NOTHING. No DOWN migration by design — rollback
-- is a pre-migration backup restore (see docs/MIGRATION_GUIDE.md).
-- The seed INSERTs below were generated from
-- server/src/config/competencyFramework.ts — do not hand-edit them; change
-- the TS config and regenerate instead.

CREATE TABLE IF NOT EXISTS competency_frameworks (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  categories JSONB NOT NULL,
  component_weights JSONB NOT NULL,
  practical_minimum_coding_score NUMERIC(5,2) NOT NULL DEFAULT 40,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS competencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('Foundation', 'Intermediate', 'Advanced')),
  evidence_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  coding_task_mapping TEXT NOT NULL,
  interview_question_mapping TEXT NOT NULL,
  rubric JSONB NOT NULL,
  min_evidence INTEGER NOT NULL DEFAULT 2 CHECK (min_evidence >= 1),
  min_evidence_description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_competency_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_version TEXT NOT NULL REFERENCES competency_frameworks(version),
  role_id TEXT NOT NULL,
  role_name TEXT NOT NULL,
  competency_code TEXT NOT NULL REFERENCES competencies(code),
  weight NUMERIC(5,2) NOT NULL CHECK (weight > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (framework_version, role_id, competency_code)
);

CREATE TABLE IF NOT EXISTS competency_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID,
  role_id TEXT NOT NULL,
  framework_version TEXT NOT NULL,
  overall_score NUMERIC(5,2),
  overall_category TEXT,
  status TEXT NOT NULL CHECK (status IN ('Complete', 'Incomplete', 'Insufficient Evidence', 'Practical Threshold Not Met')),
  component_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_role_competency_mappings_role
  ON role_competency_mappings (framework_version, role_id);
CREATE INDEX IF NOT EXISTS idx_competency_results_candidate
  ON competency_results (candidate_id);
CREATE INDEX IF NOT EXISTS idx_competency_results_version
  ON competency_results (framework_version);

-- Seed: framework v1.0.0 (generated from server/src/config/competencyFramework.ts — do not hand-edit).
INSERT INTO competency_frameworks (version, name, categories, component_weights, practical_minimum_coding_score)
VALUES ('v1.0.0', 'GroundTruth Role Competency Framework', '[{"id":"L1","label":"Foundation","min":0,"max":39,"description":"Foundational awareness only. The candidate recalls basic concepts but cannot yet apply them reliably to a real task without guidance."},{"id":"L2","label":"Developing","min":40,"max":59,"description":"Developing ability. The candidate applies core concepts to familiar problems with some support, but work is inconsistent and needs review."},{"id":"L3","label":"Job Ready","min":60,"max":79,"description":"Job ready. The candidate independently delivers correct, working solutions to typical role tasks and explains their reasoning clearly."},{"id":"L4","label":"Strong","min":80,"max":100,"description":"Strong. The candidate delivers high-quality solutions, handles edge cases and trade-offs, and can teach or review others in this area."}]'::jsonb, '{"coding":0.5,"interview":0.3,"evidence":0.2}'::jsonb, 40)
ON CONFLICT (version) DO NOTHING;

INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('be-api-design', 'API Design & REST', 'Designs clear, consistent REST APIs: resources, status codes, versioning, auth and error handling.', '["REST APIs","HTTP","FastAPI","Node.js","Express.js","JWT"]'::jsonb, 'Intermediate', '["coding-task","project","interview-answer"]'::jsonb, 'Build a REST endpoint with correct status codes, validation and auth.', 'Design a REST API for a given resource; explain status codes and versioning.', '{"L1":"Names HTTP verbs but cannot design a coherent resource layout.","L2":"Designs a basic CRUD API with guidance; status codes and errors are inconsistent.","L3":"Designs a clean, versioned REST API with correct codes, validation and auth.","L4":"Designs a production-grade API covering pagination, idempotency, rate limits and trade-offs."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing API work.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('be-databases', 'Databases & Data Modelling', 'Models relational data, writes correct SQL, understands indexes, transactions and migrations.', '["SQL","PostgreSQL","Database Design","Indexing","Migrations"]'::jsonb, 'Intermediate', '["coding-task","project","interview-answer"]'::jsonb, 'Design a schema and write queries with joins, aggregates and an index.', 'Explain normalisation, indexing and transaction isolation for a sample schema.', '{"L1":"Writes only trivial single-table queries; no modelling vocabulary.","L2":"Writes basic joins; schema has obvious redundancy or missing constraints.","L3":"Designs a normalised schema, correct joins/aggregates, sensible indexes.","L4":"Reasons about query plans, locking, migrations and scaling trade-offs."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing database work.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('be-server-logic', 'Server-Side Logic & OOP', 'Writes clean server-side code: OOP/design patterns, error handling, logging and configuration.', '["Python","OOP","Design Patterns","Error Handling","Logging"]'::jsonb, 'Intermediate', '["coding-task","project","interview-answer"]'::jsonb, 'Implement a service layer with classes, error handling and tests.', 'Explain how you would structure a service and handle failures in it.', '{"L1":"Writes unstructured scripts; no separation of concerns.","L2":"Uses classes/functions but mixes concerns and misses error paths.","L3":"Clean layered code with proper errors, logging and config separation.","L4":"Applies patterns deliberately, defends the structure, anticipates failure modes."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing server code.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('be-testing', 'Testing & Debugging', 'Writes automated tests, debugs systematically and uses logs/metrics to find root causes.', '["Pytest","Unit Testing","Debugging","Logging"]'::jsonb, 'Foundation', '["coding-task","project","interview-answer"]'::jsonb, 'Write unit tests for a service, including an edge case and a failure case.', 'Walk through how you would debug a failing endpoint in production.', '{"L1":"Tests only the happy path manually; debugging is guesswork.","L2":"Writes some unit tests; debugging follows a loose, ad-hoc trail.","L3":"Good unit-test coverage of edge cases; systematic reproduce-isolate-fix debugging.","L4":"Designs test strategy (unit/integration/contract) and debugs from metrics and traces."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing testing or debugging.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('be-system-design', 'System Design & Scalability', 'Reasons about scaling, caching, queues and failure modes of a backend system.', '["System Design","Caching","Redis","Queues","Docker"]'::jsonb, 'Advanced', '["project","interview-answer"]'::jsonb, 'Extend a service with caching and a background queue for a slow job.', 'Design a system that must handle 10x traffic; discuss caching, queues and failure.', '{"L1":"Cannot name scaling levers beyond ''bigger server''.","L2":"Names caching/queues but cannot place them correctly in a design.","L3":"Produces a sound design with caching, queues and stated trade-offs.","L4":"Designs for failure, consistency and cost; compares alternatives quantitatively."}'::jsonb, 2, 'At least 2 distinct items: one project and one interview answer showing system-design thinking.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'backend-developer', 'Backend Developer', 'be-api-design', 25)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'backend-developer', 'Backend Developer', 'be-databases', 25)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'backend-developer', 'Backend Developer', 'be-server-logic', 20)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'backend-developer', 'Backend Developer', 'be-testing', 15)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'backend-developer', 'Backend Developer', 'be-system-design', 15)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;

INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('fs-frontend', 'Frontend Fundamentals', 'Builds responsive, accessible interfaces with HTML, CSS, JavaScript and a modern framework.', '["HTML","CSS","JavaScript","React","Responsive Design"]'::jsonb, 'Intermediate', '["coding-task","project","interview-answer"]'::jsonb, 'Build a responsive form page with validation and accessible markup.', 'Explain how you structure a React component and handle its state.', '{"L1":"Static markup only; no interactivity or responsive behaviour.","L2":"Working pages with basic state; layout breaks on small screens.","L3":"Responsive, accessible components with clean state handling.","L4":"Polished, performant UI with reusable component architecture."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing frontend work.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('fs-backend-apis', 'Backend APIs', 'Builds and secures server APIs that the frontend consumes, with validation and error handling.', '["REST APIs","FastAPI","Node.js","Express.js","JWT","SQL"]'::jsonb, 'Intermediate', '["coding-task","project","interview-answer"]'::jsonb, 'Build a CRUD API with auth and validation consumed by a frontend page.', 'Explain how frontend and backend agree on contracts and handle errors.', '{"L1":"Cannot connect a frontend to an API without a worked example.","L2":"Basic endpoints work; auth and error handling are patchy.","L3":"Solid validated API with auth, consumed cleanly by the frontend.","L4":"Contract-first API design with versioning, pagination and typed clients."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing API work.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('fs-databases', 'Databases & Persistence', 'Persists application data correctly across SQL and document stores, with migrations.', '["SQL","PostgreSQL","MongoDB","Database Design","Migrations"]'::jsonb, 'Intermediate', '["coding-task","project","interview-answer"]'::jsonb, 'Model app data and implement create/read/update with correct queries.', 'Choose between SQL and a document store for a feature and justify it.', '{"L1":"Stores data in ad-hoc structures; no persistence design.","L2":"Basic persistence works; schema changes are manual and risky.","L3":"Clean models, correct queries, migrations for schema changes.","L4":"Reasons about consistency, indexing and migration safety across stores."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing persistence work.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('fs-devops', 'DevOps & Deployment', 'Ships a full-stack app: builds, environment config, containers and basic CI/CD.', '["Docker","CI/CD","Git","Deployment","Vercel","Render"]'::jsonb, 'Intermediate', '["project","interview-answer"]'::jsonb, 'Containerise an app and wire a build/deploy pipeline for it.', 'Walk through taking a full-stack app from local to production.', '{"L1":"Runs only locally; deployment is unfamiliar.","L2":"Deploys manually with guidance; env config is fragile.","L3":"Reproducible containerised deploy with env config and CI checks.","L4":"Automated pipeline with previews, rollbacks and observability."}'::jsonb, 2, 'At least 2 distinct items: one project and one interview answer showing deployment work.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('fs-state-integration', 'UI/UX Integration & State Management', 'Connects UI state, API data and user flows end to end: loading, errors, forms and navigation.', '["React","State Management","Forms","UX","TypeScript"]'::jsonb, 'Intermediate', '["coding-task","project","interview-answer"]'::jsonb, 'Build a multi-step flow with loading, error and empty states.', 'Explain how you keep client state consistent with server data.', '{"L1":"Hardcodes data in the UI; no loading or error states.","L2":"Fetches data but state gets out of sync; error handling is thin.","L3":"Consistent state, proper loading/error/empty handling across flows.","L4":"Robust state architecture with caching, optimistic updates and recovery."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing end-to-end integration.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'full-stack-developer', 'Full Stack Developer', 'fs-frontend', 20)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'full-stack-developer', 'Full Stack Developer', 'fs-backend-apis', 25)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'full-stack-developer', 'Full Stack Developer', 'fs-databases', 20)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'full-stack-developer', 'Full Stack Developer', 'fs-devops', 15)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'full-stack-developer', 'Full Stack Developer', 'fs-state-integration', 20)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;

INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('fe-html-css', 'HTML, CSS & Responsive Design', 'Writes semantic HTML and maintainable CSS; layouts work across screen sizes.', '["HTML","CSS","Responsive Design","Flexbox","Grid"]'::jsonb, 'Foundation', '["coding-task","project","interview-answer"]'::jsonb, 'Recreate a responsive layout from a reference at three widths.', 'Explain semantic HTML choices and how a layout adapts to mobile.', '{"L1":"Markup with divs only; layout breaks outside one width.","L2":"Basic responsive layout; semantics and maintainability are weak.","L3":"Semantic, responsive, maintainable CSS across widths.","L4":"Design-system-grade CSS: tokens, accessibility, cross-browser care."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing layout work.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('fe-js-ts', 'JavaScript & TypeScript', 'Writes correct modern JavaScript/TypeScript: async code, types, DOM and browser APIs.', '["JavaScript","TypeScript","Async/Await","DOM"]'::jsonb, 'Intermediate', '["coding-task","project","interview-answer"]'::jsonb, 'Implement async data fetching with error handling and typed models.', 'Explain promises, the event loop and when TypeScript types help.', '{"L1":"Writes only simple synchronous scripts; async code fails.","L2":"Async code works for the happy path; types are mostly ''any''.","L3":"Correct async flows with typed models and handled errors.","L4":"Idiomatic, well-typed code; explains event loop, closures and edge cases."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing JavaScript/TypeScript work.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('fe-react', 'React & State Management', 'Builds React apps with components, hooks and predictable state.', '["React","Hooks","State Management","Next.js"]'::jsonb, 'Intermediate', '["coding-task","project","interview-answer"]'::jsonb, 'Build a small React feature with hooks, lifted state and a list.', 'Explain hooks, re-renders and how you organise component state.', '{"L1":"Copies component examples; state behaviour is unpredictable.","L2":"Working components; prop drilling and needless re-renders.","L3":"Clean components, correct hooks, well-placed state.","L4":"Reusable component architecture with performance-aware state design."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing React work.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('fe-perf-a11y', 'Web Performance & Accessibility', 'Ships fast, accessible pages: Core Web Vitals, keyboard/ARIA support, semantic structure.', '["Web Performance","Accessibility","ARIA","SEO Basics"]'::jsonb, 'Intermediate', '["project","interview-answer"]'::jsonb, 'Optimise a slow page and fix its accessibility issues.', 'How do you measure performance and make a page accessible?', '{"L1":"Unaware of performance or accessibility concerns.","L2":"Knows the terms; fixes are superficial or break other things.","L3":"Measures, fixes real perf and a11y issues, verifies with tools.","L4":"Builds perf/a11y budgets into the workflow and prevents regressions."}'::jsonb, 2, 'At least 2 distinct items: one project and one interview answer showing performance or accessibility work.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('fe-testing-tooling', 'Testing & Frontend Tooling', 'Tests UI behaviour and uses modern build tooling confidently.', '["Testing","Vitest","Build Tools","Git","Linting"]'::jsonb, 'Foundation', '["coding-task","project","interview-answer"]'::jsonb, 'Write component tests for rendering, interaction and an error state.', 'What do you test in a UI, and how does your build pipeline work?', '{"L1":"No tests; tooling is a black box.","L2":"A few shallow tests; build errors are fixed by trial and error.","L3":"Meaningful component tests; understands the build/lint setup.","L4":"Test strategy across unit/integration/E2E plus tuned tooling."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing testing or tooling.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'frontend-developer', 'Frontend Developer', 'fe-html-css', 25)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'frontend-developer', 'Frontend Developer', 'fe-js-ts', 25)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'frontend-developer', 'Frontend Developer', 'fe-react', 25)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'frontend-developer', 'Frontend Developer', 'fe-perf-a11y', 15)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'frontend-developer', 'Frontend Developer', 'fe-testing-tooling', 10)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;

INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('py-core', 'Python Core & OOP', 'Writes idiomatic Python: data structures, OOP, decorators, context managers and the stdlib.', '["Python","OOP","Data Structures","Stdlib"]'::jsonb, 'Intermediate', '["coding-task","project","interview-answer"]'::jsonb, 'Implement a class-based solution using stdlib features and clean APIs.', 'Explain Python OOP, dunder methods and when to use a decorator.', '{"L1":"Writes Python like pseudocode; no idioms or OOP.","L2":"Working code; classes are thin wrappers, idioms are missed.","L3":"Idiomatic Python with clean OOP and appropriate stdlib use.","L4":"Expert-level idioms, metaprogramming awareness, library-grade code."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing Python code.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('py-dsa', 'Data Structures & Algorithms', 'Chooses the right data structure and algorithm and analyses time/space complexity.', '["Data Structures","Algorithms","Complexity Analysis"]'::jsonb, 'Intermediate', '["coding-task","interview-answer"]'::jsonb, 'Solve an algorithmic task with stated complexity and edge cases.', 'Compare data structures for a use case and analyse complexity.', '{"L1":"Brute force only; cannot state complexity.","L2":"Solves easy problems; complexity analysis is shaky.","L3":"Correct, efficient solutions with sound complexity reasoning.","L4":"Optimal solutions, trade-off analysis, adapts known patterns to new problems."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one interview answer showing algorithmic work.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('py-frameworks', 'Libraries & Frameworks', 'Uses Python libraries and frameworks (web, data, automation) productively and reads their docs.', '["FastAPI","Pandas","NumPy","Requests","SQLAlchemy"]'::jsonb, 'Intermediate', '["coding-task","project","interview-answer"]'::jsonb, 'Build a small FastAPI service using a third-party library correctly.', 'How do you pick and learn a new Python library for a task?', '{"L1":"Stuck without a tutorial for any library.","L2":"Uses one framework for routine tasks; docs are skimmed.","L3":"Productive across several libraries; reads docs and source when stuck.","L4":"Evaluates libraries critically, contributes fixes, designs around them."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing library use.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('py-testing', 'Testing & Debugging in Python', 'Writes pytest tests, debugs with tools and handles errors cleanly.', '["Pytest","Debugging","Error Handling","Logging"]'::jsonb, 'Foundation', '["coding-task","project","interview-answer"]'::jsonb, 'Write pytest tests including fixtures and a mocked dependency.', 'Walk through debugging a failing Python program step by step.', '{"L1":"Prints to debug; no tests.","L2":"Some tests; debugging is mostly print statements.","L3":"Good pytest coverage; uses debugger and logging systematically.","L4":"Test strategy plus profiling; prevents whole classes of bugs."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing testing or debugging.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('py-scripting', 'Scripting & Automation', 'Automates real work with scripts: files, CLI tools, APIs and scheduled jobs.', '["Scripting","CLI","Automation","APIs","Cron"]'::jsonb, 'Foundation', '["coding-task","project","interview-answer"]'::jsonb, 'Write a CLI script that reads files, calls an API and writes a report.', 'Describe a task you automated and how the script handles failures.', '{"L1":"Scripts only work once, on one machine, for one input.","L2":"Working scripts; error handling and configurability are thin.","L3":"Robust, reusable scripts with args, logging and error handling.","L4":"Production-grade automation: idempotent, tested, monitored."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing automation.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'python-developer', 'Python Developer', 'py-core', 30)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'python-developer', 'Python Developer', 'py-dsa', 20)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'python-developer', 'Python Developer', 'py-frameworks', 20)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'python-developer', 'Python Developer', 'py-testing', 15)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'python-developer', 'Python Developer', 'py-scripting', 15)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;

INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('ml-fundamentals', 'ML Fundamentals', 'Understands supervised/unsupervised learning, bias-variance, overfitting and evaluation basics.', '["Machine Learning","Scikit-learn","Statistics","Model Evaluation"]'::jsonb, 'Intermediate', '["coding-task","project","interview-answer"]'::jsonb, 'Train and compare two models on a dataset and explain the choice.', 'Explain overfitting, bias-variance and how you would detect them.', '{"L1":"Names algorithms but cannot explain when to use them.","L2":"Trains a model from a tutorial; evaluation is a single accuracy number.","L3":"Compares models with proper splits and metrics; explains trade-offs.","L4":"Designs experiments, diagnoses failure modes, justifies every choice."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing ML work.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('ml-data-prep', 'Data Preprocessing & Feature Engineering', 'Cleans messy data, handles missing values and builds useful features.', '["Pandas","NumPy","Data Cleaning","Feature Engineering"]'::jsonb, 'Intermediate', '["coding-task","project","interview-answer"]'::jsonb, 'Clean a messy dataset and engineer features for a model.', 'How do you handle missing data and leakage in a pipeline?', '{"L1":"Uses data as given; no cleaning or feature thought.","L2":"Basic cleaning; features are raw columns.","L3":"Sound cleaning, leakage-aware splits, meaningful features.","L4":"Builds reusable, validated feature pipelines with drift checks."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing data preparation.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('ml-training-eval', 'Model Training & Evaluation', 'Trains, tunes and evaluates models with the right metrics, including imbalanced data.', '["Model Training","Hyperparameter Tuning","ROC-AUC","Cross-Validation"]'::jsonb, 'Advanced', '["coding-task","project","interview-answer"]'::jsonb, 'Tune a model with cross-validation and report the right metrics.', 'Which metric would you use for an imbalanced classifier, and why?', '{"L1":"Reports accuracy only, on the training set.","L2":"Uses a test split; metric choice is unexamined.","L3":"Proper CV, tuned hyperparameters, metrics matched to the problem.","L4":"Rigorous evaluation including calibration, error analysis and fairness checks."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing training and evaluation.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('ml-dl-llm', 'Deep Learning & LLMs', 'Uses neural networks and LLM APIs/RAG: prompting, retrieval, embeddings and failure modes.', '["Deep Learning","LLM APIs","RAG","Prompt Engineering","Embeddings"]'::jsonb, 'Advanced', '["coding-task","project","interview-answer"]'::jsonb, 'Build a small RAG pipeline over documents and evaluate its answers.', 'Explain embeddings, retrieval and the failure modes of LLM apps.', '{"L1":"Has prompted a chatbot; no understanding of retrieval or limits.","L2":"Calls an LLM API; RAG is a black box.","L3":"Working RAG/LLM feature with chunking, retrieval and evaluation.","L4":"Designs LLM systems with guardrails, cost control and measured quality."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing DL/LLM work.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('ml-mlops', 'MLOps & Deployment', 'Ships models as services: versioning, APIs, monitoring and reproducibility.', '["MLOps","FastAPI","Docker","Model Serving","Monitoring"]'::jsonb, 'Advanced', '["project","interview-answer"]'::jsonb, 'Serve a trained model behind an API with input validation and logging.', 'How do you version, deploy and monitor a model in production?', '{"L1":"Models live in notebooks only.","L2":"A one-off serving script; no versioning or monitoring.","L3":"Versioned model behind a validated API with basic monitoring.","L4":"Full lifecycle: CI for models, drift detection, rollback plan."}'::jsonb, 2, 'At least 2 distinct items: one project and one interview answer showing model deployment.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'ai-ml-engineer', 'AI/ML Engineer', 'ml-fundamentals', 25)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'ai-ml-engineer', 'AI/ML Engineer', 'ml-data-prep', 20)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'ai-ml-engineer', 'AI/ML Engineer', 'ml-training-eval', 25)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'ai-ml-engineer', 'AI/ML Engineer', 'ml-dl-llm', 15)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'ai-ml-engineer', 'AI/ML Engineer', 'ml-mlops', 15)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;

INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('ds-stats', 'Statistics & Probability', 'Applies distributions, hypothesis testing, confidence intervals and experimental design.', '["Statistics","Probability","Hypothesis Testing","A/B Testing"]'::jsonb, 'Intermediate', '["coding-task","project","interview-answer"]'::jsonb, 'Analyse an experiment: test a hypothesis and report uncertainty.', 'Explain p-values, confidence intervals and when an A/B test is valid.', '{"L1":"Quotes averages only; no notion of uncertainty.","L2":"Runs a t-test from a recipe; interpretation is shaky.","L3":"Correct tests, intervals and experiment design for the question.","L4":"Designs rigorous experiments; spots bias, Simpson''s paradox, peeking."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing statistical work.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('ds-analysis-viz', 'Data Analysis & Visualisation', 'Explores data, finds patterns and communicates them with clear visualisations.', '["Pandas","Data Analysis","Visualisation","Matplotlib","EDA"]'::jsonb, 'Intermediate', '["coding-task","project","interview-answer"]'::jsonb, 'Perform EDA on a dataset and present findings with charts.', 'Walk through how you would explore an unfamiliar dataset.', '{"L1":"Prints head() and a few means; no narrative.","L2":"Some plots; findings are descriptive, not insightful.","L3":"Structured EDA with clear charts that answer the business question.","L4":"Insightful analysis with honest caveats and decision-ready visuals."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing analysis.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('ds-ml-modelling', 'ML Modelling', 'Builds predictive models end to end and interprets them honestly.', '["Machine Learning","Scikit-learn","Regression","Classification"]'::jsonb, 'Advanced', '["coding-task","project","interview-answer"]'::jsonb, 'Build a regression/classification model and interpret its results.', 'How do you choose a model and know whether to trust it?', '{"L1":"Fits a model and reports one number.","L2":"Basic model works; feature and metric choices are unexamined.","L3":"Sound modelling with validation, interpretation and limitations stated.","L4":"Rigorous modelling with error analysis, calibration and business translation."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing modelling.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('ds-sql-wrangling', 'SQL & Data Wrangling', 'Gets data out of databases and shapes it with SQL and Python.', '["SQL","PostgreSQL","Data Wrangling","Pandas"]'::jsonb, 'Intermediate', '["coding-task","project","interview-answer"]'::jsonb, 'Write SQL to answer business questions, including window functions.', 'Explain how you would get and clean data for an analysis.', '{"L1":"SELECT * only; wrangling is manual spreadsheet work.","L2":"Basic joins and filters; complex questions stall.","L3":"Confident SQL (joins, windows, CTEs) and reproducible wrangling.","L4":"Efficient, well-structured queries on large data; pipelines are reusable."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing SQL/wrangling.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('ds-communication', 'Communication & Storytelling', 'Turns analysis into decisions: clear narratives, honest caveats, stakeholder-ready reporting.', '["Communication","Storytelling","Reporting","Stakeholder Management"]'::jsonb, 'Foundation', '["project","interview-answer"]'::jsonb, 'Write a one-page summary of an analysis for a non-technical stakeholder.', 'Present an analysis result and defend its limitations.', '{"L1":"Shares raw output; no story or recommendation.","L2":"A narrative exists but buries the finding or hides caveats.","L3":"Clear story, key finding first, caveats and next steps stated.","L4":"Compelling, decision-ready communication that changes what happens next."}'::jsonb, 2, 'At least 2 distinct items: one project and one interview answer showing communication of results.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'data-scientist', 'Data Scientist', 'ds-stats', 25)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'data-scientist', 'Data Scientist', 'ds-analysis-viz', 20)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'data-scientist', 'Data Scientist', 'ds-ml-modelling', 25)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'data-scientist', 'Data Scientist', 'ds-sql-wrangling', 15)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'data-scientist', 'Data Scientist', 'ds-communication', 15)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;

INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('sde-dsa', 'Data Structures & Algorithms', 'Solves algorithmic problems efficiently and analyses complexity rigorously.', '["Data Structures","Algorithms","Complexity Analysis","Problem Solving"]'::jsonb, 'Advanced', '["coding-task","interview-answer"]'::jsonb, 'Solve medium/hard algorithmic tasks under time limits with edge cases.', 'Solve a problem on the spot and analyse its complexity.', '{"L1":"Brute force only; cannot analyse complexity.","L2":"Solves easy problems; struggles with optimisation.","L3":"Efficient solutions with correct complexity analysis.","L4":"Optimal solutions with trade-off discussion and pattern transfer."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one interview answer showing algorithmic work.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('sde-system-design', 'System Design', 'Designs large systems: APIs, storage, scaling, consistency and failure handling.', '["System Design","Scalability","Distributed Systems","Caching"]'::jsonb, 'Advanced', '["project","interview-answer"]'::jsonb, 'Design a scalable service and defend storage and consistency choices.', 'Design a system for a stated scale; discuss bottlenecks and trade-offs.', '{"L1":"Cannot decompose a system beyond one server.","L2":"Names components but the design has gaps and no numbers.","L3":"Coherent design with capacity reasoning and stated trade-offs.","L4":"Rigorous design with failure modes, consistency and cost analysis."}'::jsonb, 2, 'At least 2 distinct items: one project and one interview answer showing system design.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('sde-oop-patterns', 'OOP & Design Patterns', 'Writes maintainable object-oriented code and applies patterns where they genuinely help.', '["OOP","Design Patterns","Clean Code","SOLID"]'::jsonb, 'Intermediate', '["coding-task","project","interview-answer"]'::jsonb, 'Refactor a tangled module using appropriate patterns.', 'Explain SOLID and a pattern you have actually used, with its cost.', '{"L1":"Procedural code in classes; patterns are buzzwords.","L2":"Uses some patterns; often over-applied or misplaced.","L3":"Clean OOP; patterns used deliberately and sparingly.","L4":"Designs evolvable architectures; teaches pattern trade-offs."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing design work.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('sde-testing-quality', 'Testing & Code Quality', 'Keeps code correct and reviewable: tests, reviews, static analysis and clean practices.', '["Testing","Code Review","Clean Code","CI"]'::jsonb, 'Intermediate', '["coding-task","project","interview-answer"]'::jsonb, 'Add tests and fix review findings on a provided codebase.', 'What makes code reviewable, and what do you look for in a review?', '{"L1":"No tests; reviews are rubber stamps.","L2":"Some tests; review comments are mostly style.","L3":"Good tests and substantive, kind reviews; quality gates in CI.","L4":"Raises the team''s bar: test strategy, review culture, measurable quality."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing testing or review work.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO competencies (code, name, description, skills, difficulty, evidence_types, coding_task_mapping, interview_question_mapping, rubric, min_evidence, min_evidence_description)
VALUES ('sde-debugging', 'Problem Solving & Debugging', 'Breaks down ambiguous problems and debugs production issues systematically.', '["Problem Solving","Debugging","Troubleshooting","Incident Response"]'::jsonb, 'Intermediate', '["coding-task","project","interview-answer"]'::jsonb, 'Debug a failing service from logs and a reproduction case.', 'Walk through a hard bug you solved and how you found it.', '{"L1":"Guesses at fixes; cannot reproduce reliably.","L2":"Finds simple bugs; complex ones need help.","L3":"Systematic debugging: reproduce, isolate, verify the fix.","L4":"Diagnoses the hardest production issues and prevents recurrence."}'::jsonb, 2, 'At least 2 distinct items: one coding task and one project or interview answer showing debugging.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'software-development-engineer', 'Software Development Engineer', 'sde-dsa', 30)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'software-development-engineer', 'Software Development Engineer', 'sde-system-design', 20)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'software-development-engineer', 'Software Development Engineer', 'sde-oop-patterns', 20)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'software-development-engineer', 'Software Development Engineer', 'sde-testing-quality', 15)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;
INSERT INTO role_competency_mappings (framework_version, role_id, role_name, competency_code, weight)
VALUES ('v1.0.0', 'software-development-engineer', 'Software Development Engineer', 'sde-debugging', 15)
ON CONFLICT (framework_version, role_id, competency_code) DO NOTHING;

