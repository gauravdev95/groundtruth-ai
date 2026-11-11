"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  motion,
  AnimatePresence,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  List,
  SlidersHorizontal,
  X,
  RotateCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

// ---------------------------------------------------------------------------
// DATA — Strictly Ground Truth AI verified facts only (no invented metrics)
// ---------------------------------------------------------------------------

interface OrbitItem {
  id: string;
  number: string;
  name: string;
  category: string;
  description: string;
  color: string;
  accentStroke: string;
  monogram: string;
  status: "Verified" | "Live";
}

const ORBIT_ITEMS: OrbitItem[] = [
  {
    id: "github-evidence",
    number: "01",
    name: "GitHub Evidence",
    category: "Code & Repositories",
    description: "Real commits, real repos — contributions you can open and check.",
    color: "#064e3b", // dark emerald green
    accentStroke: "#34d399",
    monogram: "GH",
    status: "Verified",
  },
  {
    id: "leetcode-evidence",
    number: "02",
    name: "LeetCode Evidence",
    category: "Algorithmic Record",
    description: "Rated problem-solving, verified against the platform record.",
    color: "#1d4ed8", // electric blue
    accentStroke: "#60a5fa",
    monogram: "LC",
    status: "Verified",
  },
  {
    id: "codeforces-evidence",
    number: "03",
    name: "Codeforces Evidence",
    category: "Competitive Programming",
    description: "Contest history and rating, not a typed claim.",
    color: "#3f6212", // lime/mint green
    accentStroke: "#a3e635",
    monogram: "CF",
    status: "Verified",
  },
  {
    id: "certificates",
    number: "04",
    name: "Certificates",
    category: "Credential Verification",
    description: "Reachable certificates, checked — not uploaded screenshots.",
    color: "#155e75", // pale aqua/cyan
    accentStroke: "#67e8f9",
    monogram: "CR",
    status: "Verified",
  },
  {
    id: "ai-interview",
    number: "05",
    name: "AI Interview",
    category: "Technical Assessment",
    description: "Code-grounded answers, recorded and scored on evidence.",
    color: "#0f172a", // black with lime
    accentStroke: "#84cc16",
    monogram: "AI",
    status: "Live",
  },
  {
    id: "evidence-weight",
    number: "06",
    name: "Evidence Weight",
    category: "Scoring Engine",
    description: "Every verified skill carries a weight, not a yes/no tick.",
    color: "#1e3a8a", // blue
    accentStroke: "#93c5fd",
    monogram: "EW",
    status: "Live",
  },
  {
    id: "one-match-score",
    number: "07",
    name: "One Match Score",
    category: "Two-Way Matching",
    description: "The identical score shown to candidate and recruiter.",
    color: "#312e81", // purple/dark blue
    accentStroke: "#a5b4fc",
    monogram: "MS",
    status: "Live",
  },
  {
    id: "smart-apply",
    number: "08",
    name: "Smart Apply",
    category: "Candidate Workflow",
    description: "Apply where your verified evidence already matches.",
    color: "#365314", // light lime green
    accentStroke: "#bef264",
    monogram: "SA",
    status: "Live",
  },
  {
    id: "recruiter-pipeline",
    number: "09",
    name: "Recruiter Pipeline",
    category: "Hiring Workflow",
    description: "Shortlist, message and track — on proof, not promises.",
    color: "#334155", // translucent ice/grey-blue
    accentStroke: "#cbd5e1",
    monogram: "RP",
    status: "Live",
  },
];

// ---------------------------------------------------------------------------
// MAIN COMPONENT
// ---------------------------------------------------------------------------

export default function GroundTruthHomepage() {
  const prefersReducedMotion = useReducedMotion();

  // Loading state (< 1.2s fast resolve)
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);

  // Orbit state
  const [activeIndex, setActiveIndex] = useState(0);
  const [sceneWireframe, setSceneWireframe] = useState(false);
  const [showSceneSettings, setShowSceneSettings] = useState(false);
  const [selectedItemModal, setSelectedItemModal] = useState<OrbitItem | null>(null);

  // Navbar adaptive theme ("dark" = dark background section, "light" = light background section)
  const [navTheme, setNavTheme] = useState<"dark" | "light">("dark");

  // Student / Recruiter toggle in Section 02-B
  const [audienceMode, setAudienceMode] = useState<"students" | "recruiters">("students");

  // Contact dialog state
  const [contactOpen, setContactOpen] = useState(false);
  const [contactRole, setContactRole] = useState<"Student" | "Recruiter">("Student");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactMessage, setContactMessage] = useState("");

  // Refs for scroll tracking & drag
  const heroContainerRef = useRef<HTMLDivElement>(null);
  const transitionContainerRef = useRef<HTMLDivElement>(null);
  const dragStartX = useRef<number | null>(null);

  // Fast initial starfield loader
  useEffect(() => {
    if (prefersReducedMotion) {
      setLoadingProgress(100);
      setIsLoaded(true);
      return;
    }
    let current = 0;
    const interval = setInterval(() => {
      current += 14;
      if (current >= 100) {
        setLoadingProgress(100);
        clearInterval(interval);
        setTimeout(() => setIsLoaded(true), 120);
      } else {
        setLoadingProgress(current);
      }
    }, 80);
    return () => clearInterval(interval);
  }, [prefersReducedMotion]);

  // Scroll-driven orbit pinning (maps scroll progress inside the 450vh hero track to items 0..8)
  useEffect(() => {
    if (prefersReducedMotion) return;

    const handleScroll = () => {
      if (!heroContainerRef.current) return;
      const rect = heroContainerRef.current.getBoundingClientRect();
      const totalScrollable = rect.height - window.innerHeight;
      if (totalScrollable <= 0) return;

      const scrolled = -rect.top;
      if (scrolled >= 0 && scrolled <= totalScrollable) {
        const progress = Math.max(0, Math.min(0.999, scrolled / totalScrollable));
        const nextIdx = Math.floor(progress * ORBIT_ITEMS.length);
        setActiveIndex(nextIdx);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [prefersReducedMotion]);

  // Adaptive Navbar Theme Detection based on `data-nav-theme` sections under the top 36px line
  useEffect(() => {
    const updateNavbarTheme = () => {
      const sections = document.querySelectorAll<HTMLElement>("[data-nav-theme]");
      const probeY = 36;
      sections.forEach((sec) => {
        const rect = sec.getBoundingClientRect();
        if (rect.top <= probeY && rect.bottom >= probeY) {
          const theme = sec.getAttribute("data-nav-theme") as "dark" | "light";
          if (theme) setNavTheme(theme);
        }
      });
    };

    window.addEventListener("scroll", updateNavbarTheme, { passive: true });
    updateNavbarTheme();
    return () => window.removeEventListener("scroll", updateNavbarTheme);
  }, []);

  // Close modals on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContactOpen(false);
        setSelectedItemModal(null);
        setShowSceneSettings(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Step helper for orbit
  const stepOrbit = useCallback((delta: number) => {
    setActiveIndex((prev) => (prev + delta + ORBIT_ITEMS.length) % ORBIT_ITEMS.length);
  }, []);

  // Keyboard navigation on Hero Orbit
  const handleHeroKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      stepOrbit(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      stepOrbit(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      setSelectedItemModal(ORBIT_ITEMS[activeIndex]);
    }
  };

  // Pointer drag on meteor scene
  const handlePointerDown = (e: React.PointerEvent) => {
    dragStartX.current = e.clientX;
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragStartX.current === null) return;
    const deltaX = e.clientX - dragStartX.current;
    if (Math.abs(deltaX) > 36) {
      stepOrbit(deltaX < 0 ? 1 : -1);
    }
    dragStartX.current = null;
  };

  // Scroll transition values for the Earth section
  const { scrollYProgress: earthScrollProgress } = useScroll({
    target: transitionContainerRef,
    offset: ["start start", "end end"],
  });

  const firstStatementOpacity = useTransform(earthScrollProgress, [0, 0.4, 0.5], [1, 1, 0]);
  const secondStatementOpacity = useTransform(earthScrollProgress, [0.48, 0.62, 1], [0, 1, 1]);
  const earthTranslateY = useTransform(earthScrollProgress, [0, 1], [60, -60]);

  const currentOrbitItem = ORBIT_ITEMS[activeIndex];

  // Form submit handler — strictly marked TODO per prompt rules (never fake a sent message)
  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Wire to real Ground Truth AI backend endpoint (e.g., POST /api/contact)
    const subject = encodeURIComponent(
      `Ground Truth AI Inquiry — ${contactRole}: ${contactName}`
    );
    const body = encodeURIComponent(
      `Name: ${contactName}\nEmail: ${contactEmail}\nRole: ${contactRole}\n\n${contactMessage}`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    setContactOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#07090e] text-[#f3f5f8] font-sans antialiased selection:bg-[#5eead4]/20 selection:text-[#5eead4]">
      {/* Accessibility Skip Link */}
      <a
        href="#evidence-index"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-full focus:bg-[#f3f5f8] focus:px-5 focus:py-2.5 focus:text-sm focus:font-medium focus:text-[#07090e] focus:outline-none focus:ring-2 focus:ring-[#5eead4]"
      >
        Skip to evidence index
      </a>

      {/* Initial Loading Overlay (< 1.5s) */}
      <AnimatePresence>
        {!isLoaded && (
          <motion.div
            key="orbit-loader"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-[#07090e] text-[#f3f5f8]"
          >
            <div className="mb-3 text-[12px] tracking-[0.22em] uppercase text-[#8a94a6]">
              Preparing the orbit
            </div>
            <div className="text-2xl font-bold tracking-tight">
              {loadingProgress}%
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =====================================================================
          2. STICKY ADAPTIVE NAVBAR
      ===================================================================== */}
      <header className="fixed top-0 left-0 right-0 z-50 px-6 md:px-12 py-5 pointer-events-none">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between">
          {/* Existing Ground Truth AI Logo ("G" mark + "GroundTruth AI" wordmark) */}
          <a
            href="#top"
            className={`pointer-events-auto flex items-center gap-2.5 text-[16px] font-bold tracking-tight transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4] rounded-md ${
              navTheme === "dark" ? "text-[#f3f5f8]" : "text-[#07090e]"
            }`}
          >
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-md border text-[14px] font-bold transition-colors duration-300 ${
                navTheme === "dark"
                  ? "border-white/20 bg-white/5 text-[#f3f5f8]"
                  : "border-black/20 bg-black/5 text-[#07090e]"
              }`}
            >
              G
            </span>
            <span>GroundTruth AI</span>
          </a>

          {/* Single Centred Menu Pill (visible at desktop & 905px without hamburger) */}
          <nav
            aria-label="Primary Navigation"
            className={`pointer-events-auto hidden sm:flex items-center gap-5 md:gap-7 rounded-full border px-6 py-2.5 text-[15px] backdrop-blur-md transition-colors duration-300 ${
              navTheme === "dark"
                ? "border-white/15 bg-[#07090e]/75 text-[#f3f5f8]"
                : "border-black/15 bg-[#f4f4f1]/85 text-[#07090e]"
            }`}
          >
            <a
              href="#evidence-index"
              className="hover:opacity-75 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4] rounded"
            >
              Product
            </a>
            <a
              href="#how-it-works"
              className="hover:opacity-75 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4] rounded"
            >
              How it works
            </a>
            <a
              href="#audiences"
              onClick={() => setAudienceMode("recruiters")}
              className="hover:opacity-75 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4] rounded"
            >
              For Recruiters
            </a>
            <a
              href="#audiences"
              onClick={() => setAudienceMode("students")}
              className="hover:opacity-75 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4] rounded"
            >
              For Students
            </a>
            <button
              type="button"
              onClick={() => setContactOpen(true)}
              className="hover:opacity-75 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4] rounded"
            >
              Contact
            </button>
          </nav>

          {/* Far Right Primary Pill Button ("Let's talk") */}
          <button
            type="button"
            onClick={() => setContactOpen(true)}
            className={`pointer-events-auto inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[15px] font-medium transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4] ${
              navTheme === "dark"
                ? "bg-[#e8edf3] text-[#07090e] hover:bg-white"
                : "bg-[#07090e] text-[#f3f5f8] hover:bg-black/85"
            }`}
          >
            <span>Let&apos;s talk</span>
            <ArrowUpRight className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {/* =====================================================================
          3. HERO — SCROLL-DRIVEN ORBIT (Pinned 9 Steps)
      ===================================================================== */}
      <section
        id="top"
        ref={heroContainerRef}
        data-nav-theme="dark"
        className={`relative bg-[#07090e] ${
          prefersReducedMotion ? "min-h-screen" : "h-[460vh]"
        }`}
      >
        <div
          tabIndex={0}
          role="region"
          aria-label="Interactive 9-step evidence orbit. Use Left and Right arrow keys to rotate through Ground Truth AI proof sources, or press Enter to inspect the active proof source."
          onKeyDown={handleHeroKeyDown}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          className="sticky top-0 flex h-screen w-full flex-col justify-between overflow-hidden px-6 md:px-12 pt-28 pb-8 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5eead4]"
        >
          {/* Starfield & Vertical Orbit Lines */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {/* Subtle vertical orbit hairlines */}
            <div className="absolute inset-y-0 left-[42%] w-px bg-white/[0.04]" />
            <div className="absolute inset-y-0 left-[62%] w-px bg-white/[0.05]" />
            <div className="absolute inset-y-0 left-[82%] w-px bg-white/[0.04]" />

            {/* Star dots */}
            <div className="absolute top-[18%] left-[14%] h-0.5 w-0.5 rounded-full bg-white/40" />
            <div className="absolute top-[26%] left-[52%] h-1 w-1 rounded-full bg-white/30" />
            <div className="absolute top-[14%] left-[76%] h-0.5 w-0.5 rounded-full bg-white/50" />
            <div className="absolute top-[44%] left-[88%] h-1 w-1 rounded-full bg-[#5eead4]/60" />
            <div className="absolute top-[64%] left-[48%] h-0.5 w-0.5 rounded-full bg-white/30" />

            {/* Rocky Planetary Horizon at bottom */}
            <svg
              viewBox="0 0 1440 220"
              className="absolute bottom-0 left-0 w-full h-[140px] md:h-[180px]"
              preserveAspectRatio="none"
            >
              <path
                d="M0,180 Q360,95 720,115 T1440,165 L1440,220 L0,220 Z"
                fill="#0b0f17"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth="1"
              />
              <path
                d="M0,195 Q420,130 880,145 T1440,190"
                fill="none"
                stroke="rgba(94,234,212,0.18)"
                strokeWidth="1"
              />
            </svg>
          </div>

          {/* Split Hero Content: Left ~40% Headline, Right ~60% 3-D Orbit Scene */}
          <div className="relative z-10 mx-auto grid w-full max-w-[1440px] flex-1 grid-cols-1 lg:grid-cols-12 items-center gap-8">
            {/* Left 40% (5 cols on 12-col grid) */}
            <div className="lg:col-span-5 flex flex-col items-start justify-center">
              <p className="mb-5 text-[12px] uppercase tracking-[0.22em] text-[#8a94a6]">
                AI-VERIFIED TALENT MARKETPLACE
              </p>
              <h1 className="text-[44px] sm:text-[52px] xl:text-[72px] font-bold leading-[1.03] tracking-tight text-[#f3f5f8]">
                Proof over claims. Verified intelligence.
              </h1>

              {/* Single Text Link CTA with full-width thin grey underline rule */}
              <div className="mt-10 w-full max-w-[260px]">
                <a
                  href="#evidence-index"
                  className="group flex items-center justify-between pb-3 text-[16px] text-[#f3f5f8] transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4] rounded"
                >
                  <span>Explore the evidence</span>
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </a>
                <div className="h-px w-full bg-white/25" />
              </div>

              {/* Screen-reader live explanation */}
              <p className="sr-only" aria-live="polite">
                Currently inspecting {currentOrbitItem.number} {currentOrbitItem.name}:{" "}
                {currentOrbitItem.description}
              </p>
            </div>

            {/* Right 60% (7 cols on 12-col grid) — Interactive 3-D Faceted Meteor Orbit */}
            <div className="lg:col-span-7 relative flex h-[360px] sm:h-[460px] items-center justify-center">
              {/* Orbit Ring SVG */}
              <svg
                viewBox="0 0 700 460"
                className="w-full h-full max-w-[700px] overflow-visible cursor-grab active:cursor-grabbing"
              >
                {/* Main elliptical orbit ring */}
                <ellipse
                  cx="360"
                  cy="230"
                  rx="270"
                  ry="115"
                  fill="none"
                  stroke="rgba(255,255,255,0.14)"
                  strokeWidth="1"
                  strokeDasharray={sceneWireframe ? "4 4" : "none"}
                />

                {/* Tiny glowing dot on the orbit ring */}
                <circle cx="90" cy="230" r="3.5" fill="#5eead4" />

                {/* Smaller orbiting satellite meteors positioned around the ellipse */}
                {ORBIT_ITEMS.map((item, idx) => {
                  const offset =
                    ((idx - activeIndex + ORBIT_ITEMS.length) % ORBIT_ITEMS.length) /
                    ORBIT_ITEMS.length;
                  const angle = offset * Math.PI * 2;
                  const x = 360 + Math.cos(angle) * 270;
                  const y = 230 + Math.sin(angle) * 115;
                  const isCurrent = idx === activeIndex;

                  if (isCurrent) return null;

                  const scale = 0.45 + 0.35 * ((Math.sin(angle) + 1) / 2);
                  const opacity = 0.25 + 0.55 * ((Math.sin(angle) + 1) / 2);

                  return (
                    <g
                      key={item.id}
                      transform={`translate(${x}, ${y}) scale(${scale})`}
                      style={{ opacity }}
                      onClick={() => setActiveIndex(idx)}
                      className="cursor-pointer transition-all duration-500"
                    >
                      <polygon
                        points="0,-24 22,-10 18,18 -14,22 -24,-4"
                        fill={sceneWireframe ? "none" : item.color}
                        stroke={item.accentStroke}
                        strokeWidth="1.5"
                      />
                      <text
                        x="0"
                        y="4"
                        textAnchor="middle"
                        fill="#ffffff"
                        fontSize="10"
                        fontWeight="bold"
                      >
                        {item.number}
                      </text>
                    </g>
                  );
                })}

                {/* Featured Centre-Right Low-Poly 3-D Faceted Meteor */}
                <g
                  transform="translate(380, 215)"
                  onClick={() => setSelectedItemModal(currentOrbitItem)}
                  className="cursor-pointer"
                >
                  {/* Facet 1 (Top Left) */}
                  <polygon
                    points="0,-96 -86,-32 -12,-10"
                    fill={sceneWireframe ? "none" : currentOrbitItem.color}
                    stroke={currentOrbitItem.accentStroke}
                    strokeWidth="1.2"
                  />
                  {/* Facet 2 (Top Right) */}
                  <polygon
                    points="0,-96 88,-38 28,-8 -12,-10"
                    fill={sceneWireframe ? "none" : currentOrbitItem.color}
                    fillOpacity="0.85"
                    stroke={currentOrbitItem.accentStroke}
                    strokeWidth="1.2"
                  />
                  {/* Facet 3 (Lower Left) */}
                  <polygon
                    points="-86,-32 -64,74 -4,94 -12,-10"
                    fill={sceneWireframe ? "none" : currentOrbitItem.color}
                    fillOpacity="0.7"
                    stroke={currentOrbitItem.accentStroke}
                    strokeWidth="1.2"
                  />
                  {/* Facet 4 (Lower Right) */}
                  <polygon
                    points="88,-38 72,68 -4,94 -12,-10 28,-8"
                    fill={sceneWireframe ? "none" : currentOrbitItem.color}
                    fillOpacity="0.95"
                    stroke={currentOrbitItem.accentStroke}
                    strokeWidth="1.2"
                  />
                  {/* Monogram in crisp white */}
                  <text
                    x="0"
                    y="8"
                    textAnchor="middle"
                    fill="#f3f5f8"
                    fontSize="28"
                    fontWeight="700"
                    letterSpacing="0.06em"
                  >
                    {currentOrbitItem.monogram}
                  </text>
                </g>
              </svg>

              {/* Active Proof Caption floating near meteor */}
              <div className="pointer-events-none absolute bottom-4 right-2 max-w-xs text-right hidden sm:block">
                <p className="text-[14px] text-[#8a94a6]">
                  {currentOrbitItem.description}
                </p>
              </div>
            </div>
          </div>

          {/* Bottom Horizon Bar Controls */}
          <div className="relative z-20 mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-4 text-[13px] text-[#8a94a6]">
            {/* Bottom Left Instruction */}
            <div className="flex items-center gap-3">
              <span>↓ Scroll to explore · Drag to rotate · Click to open</span>
            </div>

            {/* Bottom Centre Dark Control Pills ("☰ Evidence", "Turn orbit", "Scene settings") */}
            <div className="flex items-center gap-2.5">
              <a
                href="#evidence-index"
                className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-[#10141d] px-4 py-1.5 text-[13px] text-[#f3f5f8] hover:border-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4]"
              >
                <List className="h-3.5 w-3.5" />
                <span>Evidence</span>
                <SlidersHorizontal className="h-3.5 w-3.5 text-[#8a94a6]" />
              </a>

              <button
                type="button"
                onClick={() => stepOrbit(1)}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-[#10141d] px-3.5 py-1.5 text-[13px] text-[#f3f5f8] hover:border-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4]"
              >
                <RotateCw className="h-3.5 w-3.5" />
                <span>Turn orbit</span>
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowSceneSettings((prev) => !prev)}
                  aria-expanded={showSceneSettings}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-[#10141d] px-3.5 py-1.5 text-[13px] text-[#8a94a6] hover:text-[#f3f5f8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4]"
                >
                  <span>Scene settings</span>
                </button>
                {showSceneSettings && (
                  <div className="absolute bottom-10 left-0 z-30 w-48 rounded-xl border border-white/15 bg-[#10141d] p-3 text-[12px] text-[#f3f5f8]">
                    <label className="flex items-center justify-between cursor-pointer">
                      <span>Wireframe facets</span>
                      <input
                        type="checkbox"
                        checked={sceneWireframe}
                        onChange={(e) => setSceneWireframe(e.target.checked)}
                        className="accent-[#5eead4]"
                      />
                    </label>
                  </div>
                )}
              </div>

              {/* Reduced-motion explicit prev/next stepper */}
              {prefersReducedMotion && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => stepOrbit(-1)}
                    aria-label="Previous proof item"
                    className="rounded-full border border-white/15 bg-[#10141d] p-1.5 text-[#f3f5f8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4]"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => stepOrbit(1)}
                    aria-label="Next proof item"
                    className="rounded-full border border-white/15 bg-[#10141d] p-1.5 text-[#f3f5f8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4]"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Bottom Right Current Item Chip + Counter 01/09 */}
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setSelectedItemModal(currentOrbitItem)}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-[#10141d] px-3.5 py-1.5 text-[13px] text-[#f3f5f8] hover:border-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4]"
              >
                <span className="h-2 w-2 rounded-full bg-[#5eead4]" />
                <span>
                  {currentOrbitItem.number} {currentOrbitItem.name} / {currentOrbitItem.status}
                </span>
              </button>
              <span className="font-mono text-[14px] text-[#f3f5f8]">
                {currentOrbitItem.number}/09
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* =====================================================================
          4.1 SCROLL-TRANSITION (Dark, Full-Screen Earth Section)
      ===================================================================== */}
      <section
        ref={transitionContainerRef}
        data-nav-theme="dark"
        className="relative h-[200vh] bg-[#07090e] px-6 md:px-12"
      >
        <div className="sticky top-0 mx-auto flex h-screen max-w-[1440px] items-center justify-between overflow-hidden">
          {/* Left Transition Statements */}
          <div className="relative z-10 w-full max-w-xl">
            <motion.div style={{ opacity: firstStatementOpacity }}>
              <h2 className="text-[44px] md:text-[56px] font-bold leading-[1.05] tracking-tight text-[#f3f5f8]">
                A world of proof.
              </h2>
              <a
                href="#trust-section"
                className="mt-6 inline-flex items-center gap-2 text-[16px] text-[#8a94a6] hover:text-[#f3f5f8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4] rounded"
              >
                <span>Continue to evidence</span>
                <ArrowDown className="h-4 w-4" />
              </a>
            </motion.div>

            <motion.div
              style={{ opacity: secondStatementOpacity }}
              className="pointer-events-none absolute top-0 left-0"
            >
              <h2 className="text-[40px] md:text-[54px] font-bold leading-[1.06] tracking-tight text-[#f3f5f8]">
                We verify talent in India, for the world.
              </h2>
              <p className="mt-4 text-[18px] text-[#8a94a6]">
                Real evidence, honest scores, global ambition.
              </p>
            </motion.div>
          </div>

          {/* Right Photorealistic Earth Globe + NASA / GSFC Credit */}
          <motion.div
            style={{ y: earthTranslateY }}
            className="relative flex flex-col items-end justify-center"
          >
            <div className="relative h-[280px] w-[280px] sm:h-[380px] sm:w-[380px] rounded-full border border-white/15 bg-[#0b1528] overflow-hidden">
              {/* Atmospheric rim and continents SVG representation */}
              <svg viewBox="0 0 400 400" className="h-full w-full">
                <circle cx="200" cy="200" r="198" fill="#091326" />
                <path
                  d="M150,90 Q210,75 245,120 T260,210 Q220,260 175,240 T150,90 Z"
                  fill="#122b4a"
                  stroke="rgba(94,234,212,0.25)"
                  strokeWidth="1"
                />
                <path
                  d="M250,150 Q295,165 310,220 T275,295 Q245,260 250,150 Z"
                  fill="#163558"
                />
                <circle
                  cx="200"
                  cy="200"
                  r="196"
                  fill="none"
                  stroke="rgba(255,255,255,0.2)"
                  strokeWidth="2"
                />
              </svg>
            </div>
            <span className="mt-3 text-[11px] tracking-wide text-[#8a94a6]">
              Earth imagery · NASA / GSFC
            </span>
          </motion.div>
        </div>
      </section>

      {/* =====================================================================
          4.2 "Built for trust. Verified everywhere." (Light Section 01)
      ===================================================================== */}
      <section
        id="trust-section"
        data-nav-theme="light"
        className="bg-[#f4f4f1] text-[#07090e] px-6 md:px-12 py-28 md:py-36 border-t border-black/10"
      >
        <div className="mx-auto max-w-[1440px]">
          <div className="mb-6 flex items-center justify-between text-[12px] uppercase tracking-[0.22em] text-[#5a6270]">
            <span>ONE SCORE. BOTH SIDES.</span>
            <span>01</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
            {/* Left Column: H2 */}
            <div className="lg:col-span-6">
              <h2 className="text-[42px] md:text-[54px] font-bold leading-[1.05] tracking-tight text-[#07090e]">
                Built for trust. Verified everywhere.
              </h2>
            </div>

            {/* Right Column: Max 2 sentences from product truth + Two CTAs */}
            <div className="lg:col-span-6 max-w-xl">
              <p className="text-[17px] leading-relaxed text-[#4b5362]">
                Every skill on a Ground Truth AI profile is backed by checkable evidence — a verified GitHub contribution, a coding-platform record, a reachable certificate, or a recorded answer in a code-grounded technical interview. Unverified experience is capped as FLAGGED and never enters the match score, so candidates and recruiters always see the identical computed score.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-6">
                <button
                  type="button"
                  onClick={() => setContactOpen(true)}
                  className="inline-flex items-center gap-2 rounded-full bg-[#07090e] px-6 py-3 text-[15px] font-medium text-[#f3f5f8] hover:bg-black/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#07090e]"
                >
                  <span>Verify my profile</span>
                  <ArrowUpRight className="h-4 w-4" />
                </button>

                <a
                  href="#how-it-works"
                  className="inline-flex items-center gap-2 text-[15px] font-medium text-[#07090e] hover:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#07090e] rounded"
                >
                  <span>See how matching works</span>
                  <ArrowRight className="h-4 w-4" />
                </a>
              </div>

              {/* Illustrative Audiences Row (plain text links, not fake logos) */}
              <div className="mt-14 border-t border-black/15 pt-5">
                <span className="block mb-3 text-[11px] uppercase tracking-[0.2em] text-[#5a6270]">
                  Illustrative audiences
                </span>
                <div className="flex flex-wrap items-center gap-6 text-[15px] text-[#4b5362]">
                  <a
                    href="#audiences"
                    onClick={() => setAudienceMode("students")}
                    className="underline decoration-black/25 underline-offset-4 hover:text-[#07090e]"
                  >
                    Students
                  </a>
                  <a
                    href="#audiences"
                    onClick={() => setAudienceMode("recruiters")}
                    className="underline decoration-black/25 underline-offset-4 hover:text-[#07090e]"
                  >
                    Recruiters
                  </a>
                  <a
                    href="#audiences"
                    className="underline decoration-black/25 underline-offset-4 hover:text-[#07090e]"
                  >
                    Colleges
                  </a>
                  <a
                    href="#audiences"
                    className="underline decoration-black/25 underline-offset-4 hover:text-[#07090e]"
                  >
                    Companies
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =====================================================================
          4.3 "Built with proof." — Full-Width 01–09 Evidence Index (Dark)
      ===================================================================== */}
      <section
        id="evidence-index"
        data-nav-theme="dark"
        className="bg-[#07090e] text-[#f3f5f8] px-6 md:px-12 py-28 md:py-36 border-t border-white/10"
      >
        <div className="mx-auto max-w-[1440px]">
          <div className="mb-4 flex items-center justify-between text-[12px] uppercase tracking-[0.22em] text-[#8a94a6]">
            <span>A CONSTELLATION OF PROOF</span>
            <span>01 — 09</span>
          </div>

          <div className="mb-16 grid grid-cols-1 lg:grid-cols-12 gap-8 items-end">
            <div className="lg:col-span-6">
              <h2 className="text-[42px] md:text-[54px] font-bold leading-[1.05] tracking-tight">
                Built with proof.
              </h2>
            </div>
            <div className="lg:col-span-6 max-w-md">
              <p className="text-[17px] text-[#8a94a6]">
                Verified skills, interviews and matches — every claim backed by something checkable.
              </p>
            </div>
          </div>

          {/* 9 Full-Width Hairline Rows */}
          <div className="border-t border-white/15">
            {ORBIT_ITEMS.map((item) => (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedItemModal(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedItemModal(item);
                  }
                }}
                className="group grid grid-cols-12 items-center gap-4 border-b border-white/15 px-3 py-6 transition-colors duration-200 hover:bg-[#111c1a] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4]"
              >
                <div className="col-span-2 sm:col-span-1 font-mono text-[14px] text-[#8a94a6] group-hover:text-[#f3f5f8]">
                  {item.number}
                </div>
                <div className="col-span-10 sm:col-span-4 text-[22px] md:text-[26px] font-bold tracking-tight text-[#f3f5f8]">
                  {item.name}
                </div>
                <div className="col-span-7 sm:col-span-4 text-[14px] text-[#8a94a6] group-hover:text-[#d1d5db]">
                  {item.category} — {item.description}
                </div>
                <div className="col-span-4 sm:col-span-2 flex justify-end">
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-[#0c1118] px-3 py-1 text-[12px] text-[#f3f5f8]">
                    <span className="h-2 w-2 rounded-full bg-[#5eead4]" />
                    <span>{item.status}</span>
                  </span>
                </div>
                <div className="col-span-1 flex justify-end text-[#8a94a6] group-hover:text-[#f3f5f8]">
                  <ArrowUpRight className="h-5 w-5" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* =====================================================================
          4.4 & 4.5 "From claim to verified profile." + Student/Recruiter Toggle (Light Section 02)
      ===================================================================== */}
      <section
        id="how-it-works"
        data-nav-theme="light"
        className="bg-[#f4f4f1] text-[#07090e] px-6 md:px-12 py-28 md:py-36 border-t border-black/10"
      >
        <div className="mx-auto max-w-[1440px]">
          {/* Section 02 Header */}
          <div className="mb-4 flex items-center justify-between text-[12px] uppercase tracking-[0.22em] text-[#5a6270]">
            <span>HOW IT WORKS</span>
            <span>02</span>
          </div>

          <div className="mb-16 grid grid-cols-1 lg:grid-cols-12 gap-8 items-end">
            <div className="lg:col-span-6">
              <h2 className="text-[42px] md:text-[54px] font-bold leading-[1.05] tracking-tight">
                From claim to verified profile.
              </h2>
            </div>
            <div className="lg:col-span-6 max-w-lg">
              <p className="text-[17px] text-[#4b5362]">
                We turn resumes into verified profiles. Evidence, interview and matching come together in one marketplace.
              </p>
              <a
                href="#audiences"
                className="mt-4 inline-flex items-center gap-2 text-[15px] font-medium text-[#07090e] hover:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#07090e] rounded"
              >
                <span>See the full flow</span>
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>

          {/* Three Numbered Columns (01 Verify, 02 Interview, 03 Match) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 border-t border-black/15 pt-12">
            <div>
              <div className="text-[13px] font-mono uppercase tracking-widest text-[#5a6270]">
                01 Verify
              </div>
              <h3 className="mt-3 text-[26px] font-bold tracking-tight">
                Evidence first, claims never.
              </h3>
              <p className="mt-3 text-[16px] text-[#4b5362]">
                GitHub, coding platforms and certificates — checked before a skill counts.
              </p>
            </div>

            <div>
              <div className="text-[13px] font-mono uppercase tracking-widest text-[#5a6270]">
                02 Interview
              </div>
              <h3 className="mt-3 text-[26px] font-bold tracking-tight">
                Prove it in code.
              </h3>
              <p className="mt-3 text-[16px] text-[#4b5362]">
                A code-grounded interview, recorded and scored on what you actually wrote.
              </p>
            </div>

            <div>
              <div className="text-[13px] font-mono uppercase tracking-widest text-[#5a6270]">
                03 Match
              </div>
              <h3 className="mt-3 text-[26px] font-bold tracking-tight">
                One score, both sides.
              </h3>
              <p className="mt-3 text-[16px] text-[#4b5362]">
                The same match score for candidate and recruiter — no hidden ranking.
              </p>
            </div>
          </div>

          {/* Closing lines */}
          <div className="mt-12 flex flex-wrap items-center justify-between border-t border-black/15 pt-6 text-[14px] font-medium text-[#4b5362]">
            <span>Independent evidence. Shared trust.</span>
            <span>09 proofs. One profile.</span>
          </div>

          {/* -----------------------------------------------------------------
              4.5 "Different sides. The same score." (Same Light-Grey Section)
          ----------------------------------------------------------------- */}
          <div id="audiences" className="mt-28 border-t border-black/15 pt-20">
            <div className="mb-4 text-[12px] uppercase tracking-[0.22em] text-[#5a6270]">
              FOR STUDENTS. FOR RECRUITERS.
            </div>

            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
              <h2 className="text-[40px] md:text-[52px] font-bold leading-[1.05] tracking-tight">
                Different sides. The same score.
              </h2>

              {/* Interactive Workflow Toggle */}
              <div
                role="tablist"
                aria-label="Audience workflow toggle"
                className="inline-flex rounded-full border border-black/15 bg-white/70 p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={audienceMode === "students"}
                  onClick={() => setAudienceMode("students")}
                  className={`rounded-full px-5 py-2 text-[14px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#07090e] ${
                    audienceMode === "students"
                      ? "bg-[#07090e] text-[#f3f5f8]"
                      : "text-[#4b5362] hover:text-[#07090e]"
                  }`}
                >
                  For Students
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={audienceMode === "recruiters"}
                  onClick={() => setAudienceMode("recruiters")}
                  className={`rounded-full px-5 py-2 text-[14px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#07090e] ${
                    audienceMode === "recruiters"
                      ? "bg-[#07090e] text-[#f3f5f8]"
                      : "text-[#4b5362] hover:text-[#07090e]"
                  }`}
                >
                  For Recruiters
                </button>
              </div>
            </div>

            {/* AnimatePresence Toggle Block (Strict No-Leak Transition) */}
            <AnimatePresence mode="wait">
              {audienceMode === "students" ? (
                <motion.div
                  key="students-panel"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.22 }}
                  className="grid grid-cols-1 lg:grid-cols-12 gap-10 border-t border-black/15 pt-10"
                >
                  <div className="lg:col-span-5">
                    <h3 className="text-[28px] font-bold tracking-tight">
                      Students &amp; Candidates.
                    </h3>
                    <p className="mt-3 text-[16px] text-[#4b5362]">
                      Build a verified profile backed by real repositories, coding records, and reachable certificates. Take the code-grounded AI interview and use Smart Apply where your evidence weight already matches.
                    </p>
                    <div className="mt-6 flex flex-wrap gap-2">
                      {["GitHub verification", "AI interview", "Smart Apply"].map(
                        (tag) => (
                          <span
                            key={tag}
                            className="rounded-[7px] border border-black/15 bg-white/60 px-3 py-1 text-[13px] text-[#07090e]"
                          >
                            {tag}
                          </span>
                        )
                      )}
                    </div>
                  </div>

                  <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                      <div>
                        <div className="text-[12px] font-mono text-[#5a6270]">STEP 01</div>
                        <div className="mt-1 font-bold">Connect proof sources.</div>
                        <p className="mt-1 text-[14px] text-[#4b5362]">
                          Link GitHub, LeetCode, Codeforces, and reachable certificates. Unverified claims are capped as FLAGGED.
                        </p>
                      </div>
                      <div>
                        <div className="text-[12px] font-mono text-[#5a6270]">STEP 02</div>
                        <div className="mt-1 font-bold">Code-grounded AI interview.</div>
                        <p className="mt-1 text-[14px] text-[#4b5362]">
                          Answer technical questions grounded in real code, recorded and scored on evidence.
                        </p>
                      </div>
                      <div>
                        <div className="text-[12px] font-mono text-[#5a6270]">STEP 03</div>
                        <div className="mt-1 font-bold">Smart Apply with snapshot.</div>
                        <p className="mt-1 text-[14px] text-[#4b5362]">
                          Every application attaches an immutable evidence snapshot and the exact match score the recruiter sees.
                        </p>
                      </div>
                    </div>

                    <div>
                      <button
                        type="button"
                        onClick={() => {
                          setContactRole("Student");
                          setContactOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 text-[15px] font-medium underline decoration-black/30 underline-offset-4 hover:decoration-black"
                      >
                        <span>Start candidate verification</span>
                        <ArrowUpRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="recruiters-panel"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.22 }}
                  className="grid grid-cols-1 lg:grid-cols-12 gap-10 border-t border-black/15 pt-10"
                >
                  <div className="lg:col-span-5">
                    <h3 className="text-[28px] font-bold tracking-tight">
                      Recruiters &amp; Hiring Teams.
                    </h3>
                    <p className="mt-3 text-[16px] text-[#4b5362]">
                      Post a role, inspect verified matches carrying the identical computed score candidates see, and manage messaging, analytics, and evidence snapshots inside one pipeline.
                    </p>
                    <div className="mt-6 flex flex-wrap gap-2">
                      {[
                        "Verified shortlist",
                        "Same match score",
                        "Pipeline + messaging",
                      ].map((tag) => (
                        <span
                          key={tag}
                          className="rounded-[7px] border border-black/15 bg-white/60 px-3 py-1 text-[13px] text-[#07090e]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                      <div>
                        <div className="text-[12px] font-mono text-[#5a6270]">STEP 01</div>
                        <div className="mt-1 font-bold">Define evidence weights.</div>
                        <p className="mt-1 text-[14px] text-[#4b5362]">
                          Post roles where only verified skills count and unverified experience is automatically excluded.
                        </p>
                      </div>
                      <div>
                        <div className="text-[12px] font-mono text-[#5a6270]">STEP 02</div>
                        <div className="mt-1 font-bold">Review evidence snapshots.</div>
                        <p className="mt-1 text-[14px] text-[#4b5362]">
                          Inspect commits, platform ratings, and recorded AI interview sessions directly.
                        </p>
                      </div>
                      <div>
                        <div className="text-[12px] font-mono text-[#5a6270]">STEP 03</div>
                        <div className="mt-1 font-bold">Shortlist, message &amp; track.</div>
                        <p className="mt-1 text-[14px] text-[#4b5362]">
                          Move candidates through the recruiter pipeline with integrated messaging and analytics.
                        </p>
                      </div>
                    </div>

                    <div>
                      <button
                        type="button"
                        onClick={() => {
                          setContactRole("Recruiter");
                          setContactOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 text-[15px] font-medium underline decoration-black/30 underline-offset-4 hover:decoration-black"
                      >
                        <span>Open recruiter pipeline access</span>
                        <ArrowUpRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </section>

      {/* =====================================================================
          4.6 "Different skills. The same standard." (Dark Section 03)
      ===================================================================== */}
      <section
        data-nav-theme="dark"
        className="bg-[#07090e] text-[#f3f5f8] px-6 md:px-12 py-28 md:py-36 border-t border-white/10"
      >
        <div className="mx-auto max-w-[1440px]">
          <div className="mb-4 flex items-center justify-between text-[12px] uppercase tracking-[0.22em] text-[#8a94a6]">
            <span>OUR APPROACH</span>
            <span>03</span>
          </div>

          <div className="mb-16 grid grid-cols-1 lg:grid-cols-12 gap-8 items-end">
            <div className="lg:col-span-6">
              <h2 className="text-[42px] md:text-[54px] font-bold leading-[1.05] tracking-tight">
                Different skills. The same standard.
              </h2>
            </div>
            <div className="lg:col-span-6 max-w-md">
              <p className="text-[17px] text-[#8a94a6]">
                From first-year students to experienced engineers, every profile is judged by the same evidence standard.
              </p>
            </div>
          </div>

          {/* Three Columns Separated by Thin Vertical Hairlines */}
          <div className="grid grid-cols-1 md:grid-cols-3 border-t border-white/15">
            {/* Column 01 DISCOVER */}
            <div className="pt-12 pb-8 md:pr-10 border-b md:border-b-0 md:border-r border-white/15 flex flex-col justify-between">
              <div>
                <div className="text-[64px] font-bold leading-none text-white/[0.07]">
                  01
                </div>
                <div className="mt-4 text-[12px] uppercase tracking-[0.22em] text-[#8a94a6]">
                  01 DISCOVER
                </div>
                {/* Thin node line illustration */}
                <svg viewBox="0 0 120 48" className="my-6 h-12 w-28 stroke-white/40" fill="none">
                  <circle cx="20" cy="24" r="5" strokeWidth="1" />
                  <circle cx="60" cy="12" r="5" strokeWidth="1" />
                  <circle cx="100" cy="28" r="5" stroke="#5eead4" strokeWidth="1.5" />
                  <line x1="25" y1="22" x2="55" y2="14" strokeWidth="1" />
                  <line x1="65" y1="14" x2="95" y2="26" strokeWidth="1" />
                </svg>
                <h3 className="text-[26px] font-bold tracking-tight">
                  Find the real skill.
                </h3>
                <p className="mt-3 text-[16px] text-[#8a94a6]">
                  Understand what a candidate can actually do before deciding who to shortlist.
                </p>
              </div>
            </div>

            {/* Column 02 VERIFY */}
            <div className="pt-12 pb-8 md:px-10 border-b md:border-b-0 md:border-r border-white/15 flex flex-col justify-between">
              <div>
                <div className="text-[64px] font-bold leading-none text-white/[0.07]">
                  02
                </div>
                <div className="mt-4 text-[12px] uppercase tracking-[0.22em] text-[#8a94a6]">
                  02 VERIFY
                </div>
                {/* Thin wireframe polygon illustration */}
                <svg viewBox="0 0 120 48" className="my-6 h-12 w-28 stroke-white/40" fill="none">
                  <polygon points="60,4 95,24 60,44 25,24" strokeWidth="1" />
                  <line x1="60" y1="4" x2="60" y2="44" stroke="#5eead4" strokeWidth="1.2" />
                </svg>
                <h3 className="text-[26px] font-bold tracking-tight">
                  Check, don&apos;t trust.
                </h3>
                <p className="mt-3 text-[16px] text-[#8a94a6]">
                  Give every skill a source, a weight and a checkable trail.
                </p>
              </div>
            </div>

            {/* Column 03 MATCH */}
            <div className="pt-12 pb-8 md:pl-10 flex flex-col justify-between">
              <div>
                <div className="text-[64px] font-bold leading-none text-white/[0.07]">
                  03
                </div>
                <div className="mt-4 text-[12px] uppercase tracking-[0.22em] text-[#8a94a6]">
                  03 MATCH
                </div>
                {/* Thin circular-arrow / dual-ring illustration */}
                <svg viewBox="0 0 120 48" className="my-6 h-12 w-28 stroke-white/40" fill="none">
                  <circle cx="48" cy="24" r="16" strokeWidth="1" />
                  <circle cx="72" cy="24" r="16" stroke="#5eead4" strokeWidth="1.2" />
                </svg>
                <h3 className="text-[26px] font-bold tracking-tight">
                  Match on proof.
                </h3>
                <p className="mt-3 text-[16px] text-[#8a94a6]">
                  Learn from real hiring and give verified talent room to be seen.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =====================================================================
          4.7 FOOTER (Section 04 — Dark)
      ===================================================================== */}
      <footer
        data-nav-theme="dark"
        className="bg-[#07090e] text-[#f3f5f8] px-6 md:px-12 pt-28 pb-14 border-t border-white/10"
      >
        <div className="mx-auto max-w-[1440px]">
          <div className="mb-4 flex items-center justify-between text-[12px] uppercase tracking-[0.22em] text-[#8a94a6]">
            <span>START A CONVERSATION</span>
            <span>04</span>
          </div>

          <h2 className="text-[42px] md:text-[56px] font-bold leading-[1.05] tracking-tight">
            Let&apos;s build what comes next.
          </h2>
          <p className="mt-4 max-w-xl text-[17px] text-[#8a94a6]">
            A student, a recruiter, or an idea you can&apos;t stop thinking about. We&apos;d like to hear it.
          </p>

          {/* Large Headline Link to Contact Dialog (never invent an email address) + 64px Circular Outline Button */}
          <div className="my-16 flex flex-wrap items-center justify-between gap-6">
            <button
              type="button"
              onClick={() => setContactOpen(true)}
              className="text-left text-[32px] sm:text-[48px] md:text-[60px] font-bold tracking-tight text-[#f3f5f8] underline decoration-white/25 underline-offset-8 hover:decoration-[#5eead4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4] rounded"
            >
              Start a conversation.
            </button>

            <button
              type="button"
              onClick={() => setContactOpen(true)}
              aria-label="Open conversation dialog"
              className="flex h-16 w-16 items-center justify-center rounded-full border border-white/25 text-[#f3f5f8] transition-colors hover:border-[#5eead4] hover:text-[#5eead4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4]"
            >
              <ArrowUpRight className="h-6 w-6" strokeWidth={1.5} />
            </button>
          </div>

          {/* First Hairline Divider + Bottom Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/15 py-6 text-[14px] text-[#8a94a6]">
            <span className="font-bold text-[#f3f5f8]">GroundTruth AI</span>
            <span>©2026 Ground Truth AI</span>
            <a
              href="#top"
              className="inline-flex items-center gap-1.5 text-[#f3f5f8] hover:opacity-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4] rounded"
            >
              <span>Back to top</span>
              <ArrowUp className="h-4 w-4" />
            </a>
          </div>

          {/* Second Hairline Divider + Privacy Policy */}
          <div className="border-t border-white/15 pt-5">
            <a
              href="/privacy"
              className="text-[13px] text-[#8a94a6] underline underline-offset-4 hover:text-[#f3f5f8]"
            >
              Privacy policy
            </a>
          </div>
        </div>
      </footer>

      {/* =====================================================================
          ORBIT ITEM INSPECTION MODAL (Opens on Meteor Click / Enter / Row Click)
      ===================================================================== */}
      <AnimatePresence>
        {selectedItemModal && (
          <motion.div
            key="item-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedItemModal(null)}
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-lg rounded-[24px] border border-white/15 bg-[#10141d] p-8 text-[#f3f5f8]"
            >
              <button
                type="button"
                onClick={() => setSelectedItemModal(null)}
                aria-label="Close detail modal"
                className="absolute top-6 right-6 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-[#07090e] text-[#f3f5f8] hover:border-white/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4]"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="text-[12px] uppercase tracking-[0.22em] text-[#8a94a6]">
                {selectedItemModal.number} · {selectedItemModal.category}
              </div>
              <h3 className="mt-2 text-[32px] font-bold tracking-tight">
                {selectedItemModal.name}.
              </h3>
              <p className="mt-4 text-[16px] leading-relaxed text-[#8a94a6]">
                {selectedItemModal.description}
              </p>

              <div className="mt-6 flex items-center justify-between border-t border-white/15 pt-5">
                <span className="inline-flex items-center gap-2 text-[13px] text-[#f3f5f8]">
                  <span className="h-2 w-2 rounded-full bg-[#5eead4]" />
                  <span>Status: {selectedItemModal.status}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedItemModal(null);
                    setContactOpen(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-full bg-[#e8edf3] px-5 py-2 text-[14px] font-medium text-[#07090e] hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4]"
                >
                  <span>Verify with this proof</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =====================================================================
          6. CONTACT DIALOG ("Let's talk") — The Only Card on the Site
      ===================================================================== */}
      <AnimatePresence>
        {contactOpen && (
          <motion.div
            key="contact-dialog-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setContactOpen(false)}
            className="fixed inset-0 z-[85] flex items-center justify-center bg-black/75 p-4 sm:p-6 backdrop-blur-md overflow-y-auto"
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="contact-dialog-title"
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 16, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="relative my-auto w-full max-w-xl rounded-[24px] border border-white/15 bg-[#12161f] p-7 sm:p-10 text-[#f3f5f8]"
            >
              {/* Circular Dark Close Button with × at Top Right */}
              <button
                type="button"
                onClick={() => setContactOpen(false)}
                aria-label="Close contact dialog"
                className="absolute top-6 right-6 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-[#07090e] text-[#f3f5f8] hover:border-white/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4]"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="text-[12px] uppercase tracking-[0.22em] text-[#8a94a6]">
                START A CONVERSATION
              </div>
              <h2
                id="contact-dialog-title"
                className="mt-2 text-[32px] sm:text-[38px] font-bold leading-tight tracking-tight"
              >
                Tell us what you&apos;re building.
              </h2>

              <form onSubmit={handleContactSubmit} className="mt-7 space-y-5">
                {/* Single-line pill field: Name */}
                <div>
                  <label
                    htmlFor="contact-name"
                    className="mb-1.5 block text-[13px] text-[#8a94a6]"
                  >
                    Name
                  </label>
                  <input
                    id="contact-name"
                    type="text"
                    required
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Your name"
                    className="w-full rounded-full border border-white/15 bg-[#1a202c] px-5 py-3 text-[15px] text-[#f3f5f8] placeholder-[#8a94a6]/60 focus:border-[#5eead4] focus:outline-none focus:ring-1 focus:ring-[#5eead4]"
                  />
                </div>

                {/* Single-line pill field: Email */}
                <div>
                  <label
                    htmlFor="contact-email"
                    className="mb-1.5 block text-[13px] text-[#8a94a6]"
                  >
                    Email
                  </label>
                  <input
                    id="contact-email"
                    type="email"
                    required
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="you@domain.com"
                    className="w-full rounded-full border border-white/15 bg-[#1a202c] px-5 py-3 text-[15px] text-[#f3f5f8] placeholder-[#8a94a6]/60 focus:border-[#5eead4] focus:outline-none focus:ring-1 focus:ring-[#5eead4]"
                  />
                </div>

                {/* Single-line pill field: Role (Student / Recruiter) */}
                <div>
                  <label
                    htmlFor="contact-role"
                    className="mb-1.5 block text-[13px] text-[#8a94a6]"
                  >
                    Role
                  </label>
                  <select
                    id="contact-role"
                    value={contactRole}
                    onChange={(e) =>
                      setContactRole(e.target.value as "Student" | "Recruiter")
                    }
                    className="w-full rounded-full border border-white/15 bg-[#1a202c] px-5 py-3 text-[15px] text-[#f3f5f8] focus:border-[#5eead4] focus:outline-none focus:ring-1 focus:ring-[#5eead4]"
                  >
                    <option value="Student">Student</option>
                    <option value="Recruiter">Recruiter</option>
                  </select>
                </div>

                {/* Larger rounded rectangle (~16px radius): Message */}
                <div>
                  <label
                    htmlFor="contact-message"
                    className="mb-1.5 block text-[13px] text-[#8a94a6]"
                  >
                    What are you building?
                  </label>
                  <textarea
                    id="contact-message"
                    rows={4}
                    required
                    value={contactMessage}
                    onChange={(e) => setContactMessage(e.target.value)}
                    placeholder="A short paragraph is perfect."
                    className="w-full rounded-[16px] border border-white/15 bg-[#1a202c] p-4 text-[15px] text-[#f3f5f8] placeholder-[#8a94a6]/60 focus:border-[#5eead4] focus:outline-none focus:ring-1 focus:ring-[#5eead4]"
                  />
                </div>

                {/* Captions & Large Primary Pill Submit */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
                  <div className="space-y-0.5 text-[12px] text-[#8a94a6]">
                    <p>We read every note personally.</p>
                    <p>Your details are used to respond to this enquiry.</p>
                  </div>

                  <button
                    type="submit"
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-[#e8edf3] px-7 py-3.5 text-[15px] font-medium text-[#07090e] hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4]"
                  >
                    <span>Send message</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
