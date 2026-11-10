-- Ground Truth AI — Phase 0 DEMO seed data. Not real users/jobs.
-- Idempotent: every statement uses ON CONFLICT DO NOTHING.

INSERT INTO companies (id, name, website, description) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Acme Analytics', 'https://acme.example.com',
   'Demo company — data analytics platform.'),
  ('22222222-2222-2222-2222-222222222222', 'Northwind Labs', 'https://northwind.example.com',
   'Demo company — developer tools and AI infra.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, email, full_name, role) VALUES
  ('33333333-3333-3333-3333-333333333333', 'demo.candidate@example.com', 'Demo Candidate', 'candidate'),
  ('44444444-4444-4444-4444-444444444444', 'demo.recruiter@example.com', 'Demo Recruiter', 'recruiter')
ON CONFLICT (email) DO NOTHING;

INSERT INTO candidates (id, user_id, full_name, email, headline, github_url, location, summary) VALUES
  ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333',
   'Demo Candidate', 'demo.candidate@example.com', 'Full-Stack Developer',
   'https://github.com/octocat', 'Agra, India',
   'Demo candidate profile for Phase 0 local development.'),
  ('66666666-6666-6666-6666-666666666666', NULL,
   'Second Demo Candidate', 'demo.candidate2@example.com', 'Backend Engineer (Python)',
   'https://github.com/octocat', 'Bengaluru, India',
   'Second demo candidate profile for Phase 0 local development.')
ON CONFLICT (email) DO NOTHING;

INSERT INTO jobs (id, company_id, title, description, location, employment_type, status) VALUES
  ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111',
   'Full-Stack Engineer', 'Demo role: build and ship full-stack features with React and FastAPI.',
   'Remote (India)', 'full_time', 'open'),
  ('88888888-8888-8888-8888-888888888888', '22222222-2222-2222-2222-222222222222',
   'Backend Engineer (Python)', 'Demo role: design APIs and data pipelines in Python.',
   'Bengaluru, India', 'full_time', 'open')
ON CONFLICT (id) DO NOTHING;

INSERT INTO skills (id, name, category) VALUES
  ('99999999-9999-9999-9999-999999999991', 'Python', 'Language'),
  ('99999999-9999-9999-9999-999999999992', 'TypeScript', 'Language'),
  ('99999999-9999-9999-9999-999999999993', 'React', 'Frontend'),
  ('99999999-9999-9999-9999-999999999994', 'FastAPI', 'Backend'),
  ('99999999-9999-9999-9999-999999999995', 'PostgreSQL', 'Database'),
  ('99999999-9999-9999-9999-999999999996', 'Docker', 'DevOps')
ON CONFLICT (name) DO NOTHING;

INSERT INTO candidate_skills (candidate_id, skill_id, source, confidence) VALUES
  ('55555555-5555-5555-5555-555555555555', '99999999-9999-9999-9999-999999999991', 'resume', 0.900),
  ('55555555-5555-5555-5555-555555555555', '99999999-9999-9999-9999-999999999993', 'resume', 0.850),
  ('66666666-6666-6666-6666-666666666666', '99999999-9999-9999-9999-999999999991', 'resume', 0.950),
  ('66666666-6666-6666-6666-666666666666', '99999999-9999-9999-9999-999999999994', 'resume', 0.800)
ON CONFLICT (candidate_id, skill_id, source) DO NOTHING;

INSERT INTO job_skills (job_id, skill_id, required) VALUES
  ('77777777-7777-7777-7777-777777777777', '99999999-9999-9999-9999-999999999992', TRUE),
  ('77777777-7777-7777-7777-777777777777', '99999999-9999-9999-9999-999999999993', TRUE),
  ('88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999991', TRUE),
  ('88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999994', TRUE)
ON CONFLICT (job_id, skill_id) DO NOTHING;
