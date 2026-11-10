"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ArrowRight, 
  Terminal, 
  ShieldCheck, 
  Cpu, 
  GitBranch, 
  Sparkles, 
  Layers, 
  Building2, 
  Zap
} from "lucide-react";
import Link from "next/link";

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<"student" | "recruiter">("student");

  return (
    <div className="min-h-screen bg-[#070708] text-[#F3F4F6] selection:bg-indigo-500/30 selection:text-indigo-200 font-sans overflow-x-hidden antialiased">
      
      {/* Ambient Background Glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[450px] bg-gradient-to-b from-indigo-600/15 via-purple-600/5 to-transparent blur-[140px] pointer-events-none -z-10" />
      <div className="absolute top-[800px] left-1/4 w-[600px] h-[600px] bg-blue-600/10 blur-[180px] pointer-events-none -z-10" />

      {/* 1. TOP NAVIGATION */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#070708]/80 border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 p-[1px] shadow-lg shadow-indigo-500/20">
              <div className="w-full h-full bg-[#0A0A0C] rounded-[11px] flex items-center justify-center">
                <Terminal className="w-4 h-4 text-indigo-400" />
              </div>
            </div>
            <span className="font-semibold tracking-tight text-lg text-white">GroundTruth</span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm text-zinc-400 font-medium">
            <a href="#workflow" className="hover:text-white transition-colors">Architecture</a>
            <a href="#workflow" className="hover:text-white transition-colors">Verification Core</a>
            <a href="#matching" className="hover:text-white transition-colors">Vector Engine</a>
          </nav>

          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm text-zinc-300 hover:text-white px-4 py-2 font-medium transition-colors">
              Sign In
            </Link>
            <Link href="/signup" className="group relative px-4 py-2.5 rounded-full text-xs font-semibold text-white bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.12] transition-all flex items-center gap-2 shadow-sm">
              <span>Get Started</span>
              <ArrowRight className="w-3.5 h-3.5 text-zinc-400 group-hover:translate-x-0.5 group-hover:text-white transition-all" />
            </Link>
          </div>
        </div>
      </header>

      {/* 2. HERO SECTION */}
      <section className="relative pt-32 pb-24 md:pt-40 md:pb-32 px-6">
        <div className="max-w-5xl mx-auto text-center">
          
          {/* Badge */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-xs font-medium text-indigo-300 mb-8 backdrop-blur-md shadow-inner"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
            <span>Replacing resumes with machine-checked engineering proof</span>
          </motion.div>

          {/* Main Title */}
          <motion.h1 
            initial={{ opacity: 0, y: 25 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-5xl sm:text-7xl lg:text-8xl font-bold tracking-tight text-white leading-[1.08] mb-8"
          >
            Proof over claims. <br />
            <span className="bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400 bg-clip-text text-transparent">
              Verified intelligence.
            </span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p 
            initial={{ opacity: 0, y: 25 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-lg sm:text-xl text-zinc-400 font-normal max-w-2xl mx-auto mb-12 leading-relaxed"
          >
            GroundTruth reads real repositories, evaluates contribution shares, conducts code-grounded OpenAI real-time interviews, and matches talent and jobs in a shared vector space.
          </motion.p>

          {/* CTAs */}
          <motion.div 
            initial={{ opacity: 0, y: 25 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Link href="/signup?role=student" className="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-white text-zinc-950 font-semibold text-sm hover:bg-zinc-200 transition-all shadow-xl shadow-white/10 flex items-center justify-center gap-2 group">
              <span>Verify My Student Profile</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link href="/signup?role=recruiter" className="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.1] text-white font-medium text-sm transition-all flex items-center justify-center gap-2">
              <Building2 className="w-4 h-4 text-zinc-400" />
              <span>Hire Verified Talent</span>
            </Link>
          </motion.div>

        </div>

        {/* Interactive Hero Showcase / Terminal Interface */}
        <motion.div 
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="max-w-5xl mx-auto mt-20 rounded-2xl border border-white/[0.1] bg-[#0A0A0E]/90 shadow-2xl backdrop-blur-2xl overflow-hidden relative group"
        >
          {/* Mac Window Header */}
          <div className="h-11 px-4 bg-white/[0.02] border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-rose-500/80" />
              <div className="w-3 h-3 rounded-full bg-amber-500/80" />
              <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
            </div>
            <div className="text-xs font-mono text-zinc-500 tracking-wider">groundtruth-ai-core v2.4</div>
            <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              <span>Pipeline Active</span>
            </div>
          </div>

          {/* Terminal / Code Visualizer Body */}
          <div className="p-6 md:p-8 grid grid-cols-1 md:grid-cols-12 gap-6 font-mono text-xs">
            <div className="md:col-span-5 space-y-4 border-r border-white/[0.06] pr-6">
              <div className="text-zinc-500 text-[11px] uppercase tracking-wider font-semibold">Verification Stages</div>
              <div className="space-y-2">
                <div className="p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 flex items-center justify-between">
                  <span className="flex items-center gap-2"><GitBranch className="w-3.5 h-3.5" /> 1. Repo AST & Commit Share</span>
                  <span className="text-emerald-400 font-bold">Passed (94%)</span>
                </div>
                <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.06] text-zinc-300 flex items-center justify-between">
                  <span className="flex items-center gap-2"><Cpu className="w-3.5 h-3.5 text-purple-400" /> 2. OpenAI Realtime Audio</span>
                  <span className="text-purple-300 font-bold">Evaluated</span>
                </div>
                <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.06] text-zinc-300 flex items-center justify-between">
                  <span className="flex items-center gap-2"><Layers className="w-3.5 h-3.5 text-blue-400" /> 3. pgvector Cosine Match</span>
                  <span className="text-blue-300 font-bold">92% Match</span>
                </div>
              </div>
            </div>

            <div className="md:col-span-7 bg-[#040405] p-5 rounded-xl border border-white/[0.06] flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center justify-between text-zinc-500 text-[11px]">
                  <span>AI_EVIDENCE_REPORT.json</span>
                  <span>gpt-4o structured output</span>
                </div>
                <pre className="text-emerald-400/90 leading-relaxed overflow-x-auto text-[11px]">
{`{
  "candidate": "Rahul S. (Roll: ...139)",
  "repository": "Emergency-Blood-Donor-Finder",
  "contribution_share": "84.2%",
  "rubric_scores": {
    "technical_accuracy": 39,
    "depth_of_reasoning": 24,
    "codebase_specificity": 19,
    "repo_consistency": 15
  },
  "overall_evidence_score": 97
}`}
                </pre>
              </div>
              <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-zinc-400">
                <span>Status: Signed & Verified</span>
                <span className="text-indigo-400">Smart Apply Ready →</span>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* 3. DUAL WORKFLOW TOGGLE (Student vs Recruiter) */}
      <section id="workflow" className="py-28 px-6 border-t border-white/[0.06] relative">
        <div className="max-w-6xl mx-auto">
          
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-4">
              Two sides. One synchronized core.
            </h2>
            <p className="text-zinc-400 text-sm">
              Whether you are proving your engineering capability or eliminating screening noise, GroundTruth operates on verifiable evidence.
            </p>

            {/* Toggle Switch */}
            <div className="inline-flex p-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] mt-8 backdrop-blur-md">
              <button 
                onClick={() => setActiveTab("student")}
                className={`px-6 py-2 rounded-full text-xs font-semibold transition-all ${activeTab === 'student' ? 'bg-white text-zinc-950 shadow-md' : 'text-zinc-400 hover:text-white'}`}
              >
                Student Workflow
              </button>
              <button 
                onClick={() => setActiveTab("recruiter")}
                className={`px-6 py-2 rounded-full text-xs font-semibold transition-all ${activeTab === 'recruiter' ? 'bg-white text-zinc-950 shadow-md' : 'text-zinc-400 hover:text-white'}`}
              >
                Recruiter Workflow
              </button>
            </div>
          </div>

          {/* Dynamic Content Panel */}
          <AnimatePresence mode="wait">
            {activeTab === "student" ? (
              <motion.div 
                key="student"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.4 }}
                className="grid grid-cols-1 md:grid-cols-3 gap-6"
              >
                <div className="p-8 rounded-2xl bg-white/[0.02] border border-white/[0.08] hover:border-indigo-500/40 transition-all group">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-6 group-hover:scale-110 transition-transform">
                    <GitBranch className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">1. GitHub & AST Verification</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    OAuth link repositories, run fork and commit-authorship checks, and verify your exact percentage of codebase contribution.
                  </p>
                </div>

                <div className="p-8 rounded-2xl bg-white/[0.02] border border-white/[0.08] hover:border-indigo-500/40 transition-all group">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-6 group-hover:scale-110 transition-transform">
                    <Zap className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">2. Realtime AI Interview</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    Answer code-grounded questions generated from your own source files, evaluated against a strict 4-pillar weighted rubric.
                  </p>
                </div>

                <div className="p-8 rounded-2xl bg-white/[0.02] border border-white/[0.08] hover:border-indigo-500/40 transition-all group">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-6 group-hover:scale-110 transition-transform">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">3. Smart Apply & Feed</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    Your verified evidence profile acts as your application. Instantly surface in personalized, high-match recruiter feeds.
                  </p>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="recruiter"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.4 }}
                className="grid grid-cols-1 md:grid-cols-3 gap-6"
              >
                <div className="p-8 rounded-2xl bg-white/[0.02] border border-white/[0.08] hover:border-purple-500/40 transition-all group">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-6 group-hover:scale-110 transition-transform">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">1. AI Requirement Mining</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    Post a job description; our LLM extracts must-have skills and seniority, confirmed by you before vector embedding.
                  </p>
                </div>

                <div className="p-8 rounded-2xl bg-white/[0.02] border border-white/[0.08] hover:border-purple-500/40 transition-all group">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-6 group-hover:scale-110 transition-transform">
                    <Layers className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">2. Pre-Filtered Ranked Matches</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    SQL hard filters combined with cosine similarity rank fusion return top candidates backed by verified evidence records.
                  </p>
                </div>

                <div className="p-8 rounded-2xl bg-white/[0.02] border border-white/[0.08] hover:border-purple-500/40 transition-all group">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-6 group-hover:scale-110 transition-transform">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">3. Kanban Hiring Pipeline</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    Manage candidates from application to hire with complete audit trails, interview transcripts, and code scores attached.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </section>

      {/* 4. METRICS / STATS SECTION */}
      <section className="py-20 border-t border-white/[0.06] bg-white/[0.01]">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          <div>
            <div className="text-3xl sm:text-4xl font-bold text-white mb-2">100%</div>
            <div className="text-xs sm:text-sm text-zinc-400">Code-Grounded Proof</div>
          </div>
          <div>
            <div className="text-3xl sm:text-4xl font-bold text-white mb-2">0.865</div>
            <div className="text-xs sm:text-sm text-zinc-400">Kaggle ROC-AUC Standard</div>
          </div>
          <div>
            <div className="text-3xl sm:text-4xl font-bold text-white mb-2">5-7</div>
            <div className="text-xs sm:text-sm text-zinc-400">AI Realtime Probes</div>
          </div>
          <div>
            <div className="text-3xl sm:text-4xl font-bold text-white mb-2">&lt;200ms</div>
            <div className="text-xs sm:text-sm text-zinc-400">Vector Search Latency</div>
          </div>
        </div>
      </section>

      {/* 5. FOOTER */}
      <footer className="py-12 border-t border-white/[0.06] text-xs text-zinc-500">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>© 2026-2027 GroundTruth AI. Department of Computer Science & Engineering.</div>
          <div className="flex items-center gap-6">
            <span className="hover:text-zinc-400 transition-colors cursor-pointer">Privacy Policy</span>
            <span className="hover:text-zinc-400 transition-colors cursor-pointer">Terms of Service</span>
            <span className="hover:text-zinc-400 transition-colors cursor-pointer">GitHub Repository</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
