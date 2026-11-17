"use client";

// GroundTruth AI landing page — the approved preview's exact design
// (same layout, colours, fonts and animations) with GroundTruth content only.
// Converted faithfully from the approved preview artifact
// (groundtruth-landing-page, approved 17 Nov 2026).

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent, MouseEvent } from "react";

const CSS = `:root{
  --blue:#1E2BDA; --blue2:#2F4BFF; --blue-soft:#EEF0FF; --ink:#08080A; --muted:#5A5B6B; --muted2:#A2A9C4;
  --bg:#F6F6FB; --card:#fff; --line:#E8E8F0; --navy:#0B1026;
  --radius:22px;
  --shadow:0 18px 50px rgba(30,43,218,.08),0 2px 10px rgba(8,8,10,.04);
}
*{box-sizing:border-box} html{scroll-behavior:smooth}
body{margin:0;font-family:"Manrope",system-ui,sans-serif;color:var(--ink);background:linear-gradient(180deg,#fff 0%,#F3F3FA 38%,#EEF0FF 62%,#F7F7FC 100%);-webkit-font-smoothing:antialiased;overflow-x:hidden}
h1,h2,h3{font-family:"Plus Jakarta Sans",sans-serif;margin:0;line-height:.95;letter-spacing:-.03em}
p{margin:0} a{color:inherit;text-decoration:none}
button,input{font:inherit;min-height:44px}
.wrap{max-width:1180px;margin:0 auto;padding:0 22px}
.eyebrow{font-size:11px;letter-spacing:.18em;font-weight:800;color:var(--blue2);text-transform:uppercase;text-align:center}
.sec-head{max-width:720px;margin:0 auto;text-align:center}
.sec-head h2{font-size:clamp(32px,4.6vw,52px);font-weight:800;margin:14px 0 14px}
.sec-head h2 .blue{color:var(--blue2)}
.sec-head p{color:var(--muted);font-size:16px;line-height:1.6;font-weight:500;max-width:620px;margin:0 auto}
section{padding:84px 0 20px}
.reveal{opacity:0;transform:translateY(26px);transition:opacity .7s ease,transform .7s cubic-bezier(.22,1,.36,1)}
.reveal.in{opacity:1;transform:none}
.reveal.d1{transition-delay:.08s}.reveal.d2{transition-delay:.16s}.reveal.d3{transition-delay:.24s}
.reveal-scale{transform:translateY(30px) scale(.965)}
.reveal-left{transform:translateX(-36px)}
.reveal-right{transform:translateX(36px)}
.reveal-scale.in,.reveal-left.in,.reveal-right.in{transform:none}

/* INTRO sequence (exact): 0–1s ONLY the bolt icon is visible, sitting still.
   At 1s the icon animates (assemble/settle bounce). At 2s the blue sheet wipes up,
   and only then does the full hero animate in (nav, headline, sub, CTAs, cards, stats). */
#intro{position:fixed;inset:0;z-index:200;background:linear-gradient(150deg,#3D5BFF,#1E2BDA);display:grid;place-items:center;animation:introOut .55s cubic-bezier(.7,0,.3,1) 2s forwards}
#intro .mark{width:94px;height:94px;border-radius:24px;background:rgba(255,255,255,.16);display:grid;place-items:center;color:#fff;box-shadow:0 24px 60px rgba(0,0,20,.25);animation:introMark .9s cubic-bezier(.34,1.56,.64,1) 1s}
#intro .mark svg{width:52px;height:52px}
@keyframes introMark{0%{transform:scale(1) rotate(0)}22%{transform:scale(.76) rotate(-16deg)}52%{transform:scale(1.16) rotate(7deg)}78%{transform:scale(.96) rotate(-2deg)}100%{transform:scale(1) rotate(0)}}
@keyframes introOut{to{transform:translateY(-101%);visibility:hidden}}

/* HERO headline — letter-by-letter stagger (letters split by JS; line mask kept as fallback) */
.hero h1.split .inner{animation:none}
.hero h1 .ch{display:inline-block;opacity:0;transform:translateY(.55em) rotate(5deg);animation:chIn .5s cubic-bezier(.22,1,.36,1) forwards;animation-delay:calc(2.5s + var(--i)*34ms)}
@keyframes chIn{to{opacity:1;transform:translateY(0) rotate(0)}}

/* NAV — reference: a wide, lightly-rounded bar (not a pill); logo bolt stands
   alone with no box; Sign In is a pale grey block, Get Started a blue block. */
.nav-wrap{position:sticky;top:14px;z-index:50;padding:14px 22px 0}
.nav{max-width:1180px;margin:0 auto;background:rgba(255,255,255,.94);backdrop-filter:blur(14px);border:1px solid #ECECF3;border-radius:14px;padding:9px 10px 9px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px;box-shadow:0 10px 30px rgba(8,8,10,.05);animation:navIn .7s ease 2.1s both}
@keyframes navIn{from{transform:translateY(-16px)}to{transform:none}}
.logo{display:flex;align-items:center;gap:8px;font-family:"Plus Jakarta Sans";font-weight:800;font-size:20px;letter-spacing:-.02em}
.logo-mark{width:28px;height:28px;border-radius:8px;background:var(--blue2);display:grid;place-items:center;color:#fff;box-shadow:0 6px 16px rgba(47,75,255,.35)}
.logo-mark svg{width:16px;height:16px}
.nav .logo-mark{background:none;box-shadow:none;color:var(--blue2);width:24px;height:24px}
.nav .logo-mark svg{width:22px;height:22px}
.nav-links{display:flex;gap:34px;font-size:14px;font-weight:500;color:#6E6E7C}
.nav-links a{padding:10px 2px}.nav-links a:hover{color:var(--blue)}
.nav-actions{display:flex;gap:8px;align-items:center}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:999px;padding:0 20px;min-height:44px;font-weight:700;font-size:14px;border:1px solid transparent;cursor:pointer;transition:.2s;white-space:nowrap}
.nav-actions .btn{min-height:40px;padding:0 20px;border-radius:8px;font-size:13.5px}
.nav-actions .btn-outline{background:#F2F2F6;border-color:transparent;color:#55555F}
.nav-actions .btn-outline:hover{background:#E9E9F1;color:var(--blue)}
.btn-blue{background:var(--blue2);color:#fff;box-shadow:0 10px 24px rgba(47,75,255,.28)} .btn-blue:hover{background:var(--blue);transform:translateY(-1px)}
.btn-outline{background:#fff;border-color:#E2E2EC;color:var(--ink)} .btn-outline:hover{border-color:var(--blue2);color:var(--blue)}
.btn-ghost{background:#fff;border-color:#E6E6EF}
.menu-btn{display:none;width:44px;height:44px;border-radius:50%;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:20px}

/* HERO */
.hero{padding:64px 0 0;text-align:center;position:relative}
.hero .eyebrow{animation:fadeUp .6s 2.45s ease both}
.hero h1{font-size:clamp(44px,7.2vw,76px);font-weight:800;max-width:820px;margin:18px auto 0}
.hero h1 .line{display:block;overflow:hidden}
.hero h1 .inner{display:inline-block;animation:lineUp .8s cubic-bezier(.22,1,.36,1) 2.5s both}
.hero h1 .line:nth-child(2) .inner{animation-delay:2.62s}
@keyframes lineUp{from{transform:translateY(110%);opacity:0}to{transform:none;opacity:1}}
@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
.bolt-tile{display:inline-grid;place-items:center;width:.92em;height:.92em;border-radius:.22em;background:linear-gradient(145deg,#4A6BFF,var(--blue));color:#fff;vertical-align:-.08em;margin:0 .06em;box-shadow:0 12px 26px rgba(30,43,218,.35);animation:pop .6s 3.05s cubic-bezier(.34,1.56,.64,1) both,pulse 2.6s ease-in-out 3.8s infinite}
@keyframes pop{from{transform:scale(.4) rotate(-10deg);opacity:0}to{transform:scale(1) rotate(0);opacity:1}}
.hero-mid{position:relative;max-width:1180px;margin:0 auto}
.hero-sub{color:var(--muted);font-size:16.5px;line-height:1.55;font-weight:500;max-width:480px;margin:24px auto 0;animation:fadeUp .7s 3.1s ease both;position:relative;z-index:2}
.hero-cta{display:flex;gap:12px;justify-content:center;margin-top:26px;flex-wrap:wrap;animation:riseIn .7s 3.25s cubic-bezier(.22,1,.36,1) both;position:relative;z-index:2}
@keyframes riseIn{from{transform:translateY(18px)}to{transform:none}}
.hero-cta .btn{padding:0 24px;min-height:48px;border-radius:9px}
.play{width:20px;height:20px;border-radius:50%;border:1.6px solid #C9C9D6;display:grid;place-items:center;font-size:9px;padding-left:2px}
/* Ghost UI flanking the sub-text, exactly as in the reference: very faint,
   washed-out workflow pieces on the left and a pale Performance card on the
   right — decoration, not solid notification cards. */
.ghost{position:absolute;top:50%;z-index:1;opacity:0;animation:ghostIn 1s ease 3.45s forwards,floaty 7s ease-in-out 4.4s infinite}
@keyframes ghostIn{from{opacity:0;transform:translateY(calc(-50% + 12px))}to{opacity:1;transform:translateY(-50%)}}
@keyframes floaty{0%,100%{margin-top:0}50%{margin-top:-7px}}
.ghost-left{left:-6px;width:270px;height:150px;transform:translateY(-50%)}
.ghost-play{position:absolute;left:0;top:50%;transform:translateY(-50%);background:#fff;border:1px solid #E9EAF2;border-radius:10px;box-shadow:0 10px 26px rgba(8,8,10,.05);padding:10px 14px;display:flex;align-items:center;gap:10px}
.play-dot{width:26px;height:26px;flex:none;border-radius:50%;background:#1FA97A;color:#fff;display:grid;place-items:center;font-size:10px;padding-left:2px}
.ghost-lines i{display:block;height:6px;border-radius:3px;background:#D8DAE4;width:64px}
.ghost-lines i.short{width:42px;margin-top:6px;background:#E4E5EC}
.ghost-wires{position:absolute;left:118px;top:8px;width:120px;height:134px}
.ghost-mini{position:absolute;width:34px;height:28px;background:#fff;border:1px solid #E7E8F1;border-radius:7px;box-shadow:0 8px 20px rgba(8,8,10,.05);display:grid;place-items:center;font-size:14px}
.gm-mail{right:26px;top:2px;color:#8B7CF0;background:linear-gradient(180deg,#F4F1FF,#fff)}
.gm-eye{right:44px;bottom:0;color:#9AA3C7}
.ghost-right{right:-4px;width:238px;transform:translateY(-50%);animation-delay:3.6s,4.6s}
.ghost-perf{background:rgba(255,255,255,.75);border:1px solid #E9EAF2;border-radius:10px;box-shadow:0 12px 28px rgba(8,8,10,.05);padding:12px 14px;text-align:left;-webkit-mask-image:linear-gradient(180deg,#000 62%,transparent 108%);mask-image:linear-gradient(180deg,#000 62%,transparent 108%)}
.gp-head{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:9.5px;color:#A6A9B8;font-weight:600}
.gp-live{color:#55555F;font-weight:700;white-space:nowrap}
.gp-live b{color:#111;font-weight:800}
.gp-row{margin-top:12px;font-size:9.5px;color:#B4B7C4}
.gp-badge{display:inline-block;margin-top:10px;font-size:8.5px;font-weight:700;color:#8E92A3;background:#F1F1F6;border:1px solid #E6E7EE;border-radius:5px;padding:3px 7px;letter-spacing:.06em}
.faint-nums{position:absolute;right:7%;bottom:10px;color:#C2C5D4;font-weight:600;display:flex;gap:20px;font-size:15px;z-index:2;animation:fadeUp .7s 3.55s ease both}
.hero-bottom{max-width:1180px;margin:44px auto 0;background:linear-gradient(180deg,rgba(238,240,255,0) 0%,#EDEFFB 88%);border-top:1px solid rgba(162,169,196,.22);padding:28px 12px 36px;display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap}
.stat{text-align:left}.stat strong{font-family:"Plus Jakarta Sans";font-size:28px;display:flex;gap:8px;align-items:center}
.stat strong i{font-style:normal;width:30px;height:30px;border-radius:8px;background:#EEF0FF;display:grid;place-items:center;font-size:14px}
.stat>span{color:var(--muted);font-size:12px;font-weight:600;display:block;margin-top:4px}
.stat strong span{font-size:28px;color:var(--ink)}
.logos{display:flex;gap:38px;align-items:center;color:#8F8F9B;font-weight:800;font-size:19px;flex-wrap:wrap;justify-content:center}
.logos span{opacity:0;animation:fadeUp .6s 3.35s ease both}.logos span:nth-child(2){animation-delay:3.48s}.logos span:nth-child(3){animation-delay:3.61s}

/* DASHBOARD */
.dash{max-width:1060px;margin:38px auto 0;background:#fff;border:1px solid #E9E9F2;border-radius:20px;box-shadow:0 30px 80px rgba(30,43,218,.10);overflow:hidden;text-align:left}
.dash-top{display:flex;align-items:center;gap:16px;padding:12px 16px;border-bottom:1px solid #EFEFF5;font-size:12px;color:var(--muted)}
.dash-top .logo{font-size:15px}.dash-top .logo-mark{width:22px;height:22px;border-radius:6px}
.search{flex:1;max-width:260px;background:#F7F7FA;border-radius:8px;padding:7px 10px}
.dash-top .spacer{flex:1}.avatar{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#FFB38A,#FF7A9E);display:inline-block;vertical-align:middle}
.dash-body{display:grid;grid-template-columns:168px 1fr}
.sidebar{border-right:1px solid #EFEFF5;padding:16px 12px;font-size:12px;color:var(--muted);font-weight:600}
.sidebar div{padding:8px 10px;border-radius:8px;margin-bottom:2px}.sidebar .active{background:#EEF0FF;color:var(--blue);font-weight:800}
.sidebar small{display:block;letter-spacing:.12em;font-size:9px;margin:14px 10px 6px;color:#B6B9C9}
.dash-main{padding:20px}
.dash-main h3{font-size:20px;letter-spacing:-.02em}.dash-main>p{color:var(--muted);font-size:12px;margin-top:4px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:18px}
.kpi{border:1px solid #EFEFF5;border-radius:14px;padding:14px}
.kpi label{font-size:11px;color:var(--muted);font-weight:700;display:flex;gap:6px;align-items:center}
.kpi strong{font-family:"Plus Jakarta Sans";font-size:24px;display:block;margin-top:6px}
.kpi em{font-style:normal;color:#16A36A;font-size:11px;font-weight:800;margin-left:6px}
.kpi em.down{color:#E14B6D}
.mini-chart{height:34px;margin-top:8px}
.dash-grid{display:grid;grid-template-columns:1.7fr 1fr;gap:12px;margin-top:12px}
.panel{border:1px solid #EFEFF5;border-radius:14px;padding:16px}
.panel h4{margin:0 0 4px;font-size:13px}.panel p{font-size:11px;color:var(--muted)}
.chart-svg{width:100%;height:150px;margin-top:10px}
.chart-line{stroke-dasharray:900;stroke-dashoffset:900}
.in .chart-line{animation:draw 1.6s .2s ease forwards}
@keyframes draw{to{stroke-dashoffset:0}}
.sugg{display:flex;gap:10px;padding:11px 0;border-bottom:1px solid #F1F1F6;font-size:12px}
.sugg:last-child{border:0}.sugg i{width:26px;height:26px;flex:none;border-radius:8px;background:#EEF0FF;display:grid;place-items:center;font-style:normal}
.sugg b{display:block;font-size:12px}.sugg span{color:var(--muted);font-size:11px;line-height:1.4;display:block}

/* CAPABILITIES */
.big-card{max-width:1060px;margin:36px auto 0;background:#fff;border:1px solid #E9E9F2;border-radius:24px;box-shadow:var(--shadow);padding:30px;display:grid;grid-template-columns:1fr 1.2fr;gap:24px;align-items:center;text-align:left}
.big-card h3{font-size:24px}.big-card p{color:var(--muted);line-height:1.6;font-size:14px;margin-top:70px;max-width:340px}
.hub{position:relative;background:linear-gradient(180deg,#FBFBFF,#F3F4FF);border:1px solid #ECECF6;border-radius:18px;min-height:250px;display:grid;place-items:center;overflow:hidden}
.hub:before,.hub:after{content:"";position:absolute;background:#E4E6F5}
.hub:before{width:1px;height:100%;left:50%}.hub:after{height:1px;width:100%;top:50%}
.hub-center{width:64px;height:64px;border-radius:16px;background:linear-gradient(145deg,#4A6BFF,var(--blue));display:grid;place-items:center;color:#fff;position:relative;z-index:2;box-shadow:0 16px 34px rgba(30,43,218,.35);animation:pulse 2.6s ease-in-out infinite}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
.hub-center svg{width:30px;height:30px}
.hub-tag{position:absolute;left:50%;top:calc(50% + 40px);transform:translateX(-50%);background:#0B1026;color:#fff;font-size:10px;padding:5px 9px;border-radius:999px;z-index:3;font-weight:700}
.hub-icon{position:absolute;width:42px;height:42px;border-radius:11px;background:#fff;border:1px solid #E6E7F2;box-shadow:0 8px 20px rgba(8,8,10,.06);display:grid;place-items:center;font-size:17px;z-index:2}
.cards3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:1060px;margin:16px auto 0;text-align:left}
.cap{background:#fff;border:1px solid #E9E9F2;border-radius:20px;padding:18px;box-shadow:0 10px 30px rgba(8,8,10,.03)}
.cap-preview{background:linear-gradient(180deg,#FBFBFF,#F4F5FF);border:1px solid #ECECF6;border-radius:14px;padding:14px;min-height:138px;font-size:12px}
.cap h3{font-size:19px;line-height:1.15;margin-top:16px;max-width:180px}
.live-dot{width:8px;height:8px;border-radius:50%;background:#22C07A;display:inline-block;animation:blink 1.4s infinite}
@keyframes blink{50%{opacity:.25}}
.alert-box{background:#fff;border:1px solid #E9EAF3;border-radius:10px;padding:10px;margin-top:10px;box-shadow:0 8px 18px rgba(8,8,10,.05)}
.big-num{font-family:"Plus Jakarta Sans";font-size:28px;font-weight:800;text-align:center;margin-top:12px}

/* INTEGRATIONS — reference: full lavender panel, dense contour waves flowing
   behind two centred rows of white brand tiles (6 + 5). */
.integrations{position:relative;overflow:hidden;background:linear-gradient(180deg,#F5F6FD 0%,#EBEDFA 52%,#E2E5F8 100%);margin-top:70px;padding:88px 0 96px}
.integrations .wrap{position:relative;z-index:2}
.waves{position:absolute;inset:0;height:100%;opacity:.55;pointer-events:none;width:100%}
.logo-grid{max-width:500px;margin:44px auto 0;display:flex;flex-wrap:wrap;justify-content:center;gap:16px;position:relative}
.logo-tile{background:#fff;border:1px solid rgba(233,234,244,.9);border-radius:14px;width:68px;height:68px;display:grid;place-items:center;box-shadow:0 12px 26px rgba(43,54,160,.08);transition:.2s}
.logo-tile svg{width:36px;height:36px;display:block}
.logo-tile:hover{transform:translateY(-4px);box-shadow:var(--shadow)}
.center-btn{text-align:center;margin-top:34px;position:relative}
.center-btn .btn{min-height:46px;padding:0 22px;font-size:13.5px;box-shadow:0 10px 24px rgba(43,54,160,.10)}

/* PRICING */
.toggle-row{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:22px;font-weight:700;font-size:14px}
.toggle{width:52px;height:28px;border-radius:999px;background:#D9DBE8;border:0;position:relative;cursor:pointer;padding:0;min-height:28px}
.toggle:after{content:"";position:absolute;width:22px;height:22px;border-radius:50%;background:#fff;top:3px;left:3px;transition:.25s;box-shadow:0 2px 8px rgba(0,0,0,.2)}
.toggle.on{background:var(--blue2)}.toggle.on:after{left:27px}
.off{color:var(--blue);font-size:12px;background:#EEF0FF;padding:4px 8px;border-radius:999px}
.price-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;max-width:900px;margin:34px auto 0;text-align:left}
.price-card{background:#fff;border:1px solid #E4E4EE;border-radius:20px;padding:26px;position:relative;overflow:hidden}
.price-card.featured{border:2px solid var(--blue2);box-shadow:0 24px 60px rgba(30,43,218,.14)}
.best{position:absolute;top:0;left:0;right:0;background:var(--blue2);color:#fff;text-align:center;font-size:11px;letter-spacing:.16em;font-weight:800;padding:8px}
.price-card.featured{padding-top:52px}
.price-head{display:flex;justify-content:space-between;gap:14px}
.price-head h3{font-size:18px}.price-head p{color:var(--muted);font-size:12px;line-height:1.5;max-width:190px}
.price{font-family:"Plus Jakarta Sans";font-size:34px;font-weight:800;margin:18px 0 4px}.price span{font-family:"Manrope";font-size:13px;color:var(--muted);font-weight:600}
.price-card ul{list-style:none;padding:16px 0 0;margin:16px 0 20px;border-top:1px solid #EFEFF5;display:grid;gap:11px;font-size:14px;font-weight:600}
.price-card li:before{content:"✓";color:var(--blue);font-weight:800;margin-right:9px}
.price-card .btn{width:100%;border-radius:10px}

/* TESTIMONIALS */
.testi{display:grid;grid-template-columns:1fr 1.35fr;gap:36px;max-width:1060px;margin:10px auto 0;text-align:left;align-items:start}
.testi .eyebrow{text-align:left}.testi h2{font-size:42px;margin-top:12px}
.testi-stats{display:flex;gap:38px;margin-top:52px}
.testi-stats strong{font-family:"Plus Jakarta Sans";font-size:34px;display:block}
.testi-stats>div>span{color:var(--muted);font-size:12px;font-weight:600;display:block;margin-top:4px}
.testi-stats strong span{font-size:34px;color:var(--ink)}
.quote-card{background:#fff;border:1px solid #E9E9F2;border-radius:20px;padding:28px;box-shadow:var(--shadow);min-height:280px;display:flex;flex-direction:column}
.quote-count{font-weight:800;font-size:15px}
.quote-text{font-size:17px;line-height:1.65;font-weight:600;margin-top:20px}
.quote-foot{margin-top:auto;padding-top:24px;display:flex;align-items:center;justify-content:space-between;gap:14px}
.person{display:flex;gap:12px;align-items:center}.person .avatar{width:42px;height:42px}
.person b{display:block;font-size:13px}.person span{color:var(--muted);font-size:12px}
.arrows{display:flex;gap:8px}.arrows button{width:44px;height:44px;border-radius:50%;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:18px}.arrows button:hover{background:var(--blue2);color:#fff;border-color:var(--blue2)}

/* FAQ */
.faq-list{max-width:760px;margin:34px auto 0;text-align:left;display:grid;gap:10px}
.faq-item{background:#fff;border:1px solid #E7E7F0;border-radius:14px;overflow:hidden}
.faq-q{width:100%;background:none;border:0;display:flex;align-items:center;gap:12px;padding:18px;text-align:left;font-weight:700;font-size:15px;cursor:pointer;color:var(--ink)}
.faq-q .chev{margin-left:auto;transition:.3s;color:var(--muted)}
.faq-item.open .chev{transform:rotate(180deg)}
.faq-a{max-height:0;overflow:hidden;transition:max-height .45s ease}
.faq-a p{padding:0 18px 18px 46px;color:var(--muted);font-size:14px;line-height:1.65}
.faq-icon{width:22px;text-align:center}
.cta-bar{max-width:760px;margin:14px auto 0;background:var(--navy);color:#fff;border-radius:14px;padding:20px 22px;display:flex;align-items:center;justify-content:space-between;gap:16px;text-align:left;flex-wrap:wrap}
.cta-bar b{font-size:15px}.cta-bar p{color:#B9BDD1;font-size:13px;margin-top:3px}

/* FOOTER */
footer{padding:70px 0 26px}
.foot{max-width:1060px;margin:0 auto;background:#fff;border:1px solid #E9E9F2;border-radius:24px;padding:14px;display:grid;grid-template-columns:1.05fr 1.5fr 1.1fr;gap:14px;box-shadow:var(--shadow)}
.foot-blue{background:linear-gradient(160deg,#3D5BFF,#1E2BDA);color:#fff;border-radius:18px;padding:26px;display:flex;flex-direction:column;min-height:300px}
.foot-blue .logo{color:#fff}.foot-blue .logo-mark{background:rgba(255,255,255,.18)}
.foot-blue p{font-size:19px;line-height:1.4;font-weight:600;margin-top:auto;max-width:240px}
.socials{display:flex;gap:10px;margin-top:18px}.socials a{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.14);display:grid;place-items:center;font-weight:800;font-size:13px}.socials a:hover{transform:translateY(-2px);background:rgba(255,255,255,.25)}
.foot-cols{display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:22px 10px}
.foot-cols h4{margin:0 0 14px;font-size:14px}.foot-cols a{display:block;color:var(--muted);font-size:13px;padding:6px 0;font-weight:600}.foot-cols a:hover{color:var(--blue)}
.copy{color:var(--muted);font-size:12px;margin-top:54px}
.foot-right{padding:22px 14px;display:flex;flex-direction:column;justify-content:flex-end}
.foot-right p{font-size:18px;font-weight:700;line-height:1.35}
.demo-form{display:flex;gap:8px;margin-top:16px}.demo-form input{flex:1;min-width:0;border:1px solid var(--line);border-radius:10px;padding:0 12px;font-size:13px}
.demo-form .btn{border-radius:10px}
.foot-note{text-align:center;color:var(--muted2);font-size:12px;margin-top:16px}

/* ===== SECTION MOTION (triggered when the section gets .in on scroll) ===== */
/* Dashboard: bars grow, gauge sweeps, sparklines draw, suggestions slide in */
.bar{transform-box:fill-box;transform-origin:50% 100%;transform:scaleY(0)}
.dash.in .bar{animation:growBar .85s cubic-bezier(.22,1,.36,1) forwards}
@keyframes growBar{to{transform:scaleY(1)}}
.wbar{transform:scaleX(0);transform-origin:left center}
.dash.in .wbar{animation:growX .85s cubic-bezier(.22,1,.36,1) forwards}
@keyframes growX{to{transform:scaleX(1)}}
.spark{stroke-dasharray:100;stroke-dashoffset:100}
.dash.in .spark{animation:draw2 1.3s .25s ease forwards}
.gauge-arc{stroke-dasharray:100;stroke-dashoffset:100;transition:stroke-dashoffset 1.5s cubic-bezier(.22,1,.36,1) .35s}
.dash.in .gauge-arc{stroke-dashoffset:30}
@keyframes draw2{to{stroke-dashoffset:0}}
.chart-area{opacity:0;transition:opacity 1s ease .7s}
.dash.in .chart-area{opacity:1}
.dash.in .sugg{animation:suggIn .6s cubic-bezier(.22,1,.36,1) backwards}
@keyframes suggIn{from{opacity:0;transform:translateX(22px)}to{opacity:1;transform:none}}
.dash.in .kpi{animation:kpiIn .6s cubic-bezier(.22,1,.36,1) backwards}
.dash.in .kpi:nth-child(2){animation-delay:.1s}.dash.in .kpi:nth-child(3){animation-delay:.2s}.dash.in .kpi:nth-child(4){animation-delay:.3s}
@keyframes kpiIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}

/* Capabilities hub: icons pop in staggered, pulse rings, signals travel the cross lines */
.big-card.in .hub-icon{animation:popIn .55s cubic-bezier(.34,1.56,.64,1) backwards}
.big-card.in .hub-icon:nth-of-type(2){animation-delay:.1s}.big-card.in .hub-icon:nth-of-type(3){animation-delay:.2s}
.big-card.in .hub-icon:nth-of-type(4){animation-delay:.3s}.big-card.in .hub-icon:nth-of-type(5){animation-delay:.4s}
.big-card.in .hub-icon:nth-of-type(6){animation-delay:.5s}
@keyframes popIn{from{opacity:0;transform:scale(.3)}to{opacity:1;transform:scale(1)}}
.hub-center:before,.hub-center:after{content:"";position:absolute;inset:0;border-radius:16px;border:2px solid rgba(47,75,255,.45);animation:ring 2.8s ease-out infinite;pointer-events:none}
.hub-center:after{animation-delay:1.4s}
@keyframes ring{from{transform:scale(1);opacity:.85}to{transform:scale(2);opacity:0}}
.sig-dot{position:absolute;width:9px;height:9px;border-radius:50%;background:var(--blue2);box-shadow:0 0 0 4px rgba(47,75,255,.15);z-index:1}
.sd1{top:calc(50% - 4px);animation:travelX 3.6s ease-in-out infinite}
.sd2{left:calc(50% - 4px);animation:travelY 4.4s ease-in-out infinite}
@keyframes travelX{0%{left:6%;opacity:0}12%{opacity:1}88%{opacity:1}100%{left:92%;opacity:0}}
@keyframes travelY{0%{top:8%;opacity:0}12%{opacity:1}88%{opacity:1}100%{top:90%;opacity:0}}

/* Integrations: waves drift slowly, tiles pop in one by one */
.waves{animation:drift 12s ease-in-out infinite alternate}
@keyframes drift{from{transform:scale(1.07) translateX(-20px)}to{transform:scale(1.07) translateX(20px)}}
.logo-grid.in .logo-tile{animation:tileIn .55s cubic-bezier(.34,1.56,.64,1) backwards;animation-delay:calc(var(--n,0)*70ms)}
@keyframes tileIn{from{opacity:0;transform:translateY(18px) scale(.85)}to{opacity:1;transform:none}}

/* Pricing: amount pulses on Monthly/Annual switch */
.price.bump{animation:bump .45s ease}
@keyframes bump{35%{transform:scale(1.1)}}
.price-card{transition:transform .3s ease,box-shadow .3s ease}
.price-card:hover{transform:translateY(-5px);box-shadow:var(--shadow)}

/* Testimonials: quote text slides (JS drives transform/opacity) */
#quoteText{will-change:transform,opacity}

@media(max-width:860px){
  .nav-wrap{padding:10px 12px 0}.nav{padding:6px 6px 6px 12px;gap:8px}.logo{font-size:18px}.nav-actions{gap:6px}.nav-actions .btn{padding:0 13px;font-size:13px;min-height:40px}.menu-btn{display:block;width:40px;height:40px;flex:none}
  .nav-links{display:none}
  .nav-links.open{display:flex;position:absolute;top:76px;left:22px;right:22px;background:#fff;border:1px solid var(--line);border-radius:16px;padding:14px;flex-direction:column;gap:4px;box-shadow:var(--shadow)}
  .dash-body{grid-template-columns:1fr}.sidebar{display:none}
  .kpis{grid-template-columns:1fr 1fr}.dash-grid,.big-card,.cards3,.price-grid,.testi,.foot{grid-template-columns:1fr}
  .logo-tile{width:58px;height:58px}.logo-tile svg{width:30px;height:30px}
  .ghost{display:none}
  .faint-nums{position:static;justify-content:center;margin-top:16px}
  .hero-bottom{justify-content:center;text-align:center}.stat{text-align:center}
  .big-card p{margin-top:16px} section{padding-top:60px}
  .foot-blue{min-height:220px}
  .dash-top .search,.dash-top .btn{display:none}.dash-top{flex-wrap:wrap}
}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.ghost{opacity:1!important}.reveal{opacity:1;transform:none}.bar,.wbar{transform:none!important}.spark,.chart-line{stroke-dashoffset:0!important}.gauge-arc{stroke-dashoffset:30!important}.chart-area{opacity:1!important}.hero h1 .ch{opacity:1!important;transform:none!important}#intro{display:none!important}}`;

const BOLT_PATH = "M13 2 4.5 13.5H11L9.8 22 19 10h-6.5L13 2z";

function Bolt({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d={BOLT_PATH} />
    </svg>
  );
}

// Hero headline letters, staggered exactly like the reference video
// (animation-delay: 2.5s + index * 34ms, via the .ch CSS rule).
function letters(text: string, start: number) {
  return text.split("").map((ch, k) => (
    <span key={k} className="ch" style={{ "--i": start + k } as CSSProperties}>
      {ch === " " ? " " : ch}
    </span>
  ));
}

const QUOTES = [
  {
    t: "“GroundTruth gave us real proof behind every candidate. Instead of trusting resumes, we shortlist on verified GitHub work, coding records and interview scores. Within the first quarter, our shortlist quality improved measurably.”",
    r: "Head of Talent",
    c: "B2B Technology Company",
  },
  {
    t: "“We stopped debating inflated resumes. Every skill on a GroundTruth profile is backed by evidence we can open and check, so our interview rounds start from facts, not claims.”",
    r: "VP of Engineering Hiring",
    c: "SaaS Company",
  },
  {
    t: "“The AI interview changed our screening. Questions come from the candidate's own verified repositories, and the same match score is shown to both sides — candidates trust it, and so do we.”",
    r: "Director of Recruiting",
    c: "FinTech Company",
  },
];

const FAQS = [
  {
    icon: "⬡",
    q: "Does GroundTruth replace our ATS?",
    a: "No. GroundTruth works alongside your existing hiring tools — it verifies candidate evidence and computes match scores, so your team shortlists on proof instead of self-reported resumes.",
  },
  {
    icon: "▦",
    q: "Can candidates type their own skills?",
    a: "No — and that's the point. Skills are never typed. They are derived only from verified sources: technologies detected in real repositories and competencies from verified LeetCode and Codeforces records.",
  },
  {
    icon: "◎",
    q: "Is GroundTruth just a resume screener?",
    a: "It's the opposite. Resumes are claims. GroundTruth checks every claim against third-party evidence, runs a code-grounded AI interview, and shows the identical match score to candidate and recruiter.",
  },
  {
    icon: "👥",
    q: "What kind of teams is GroundTruth built for?",
    a: "Hiring teams and candidates who want proof over claims — from growing teams on the Basic plan to scaling organizations on Enterprise.",
  },
];

export default function Home() {
  const [introGone, setIntroGone] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [qi, setQi] = useState(0);
  const [quoteFading, setQuoteFading] = useState(false);
  const [faqOpen, setFaqOpen] = useState(0);
  const [demoMsg, setDemoMsg] = useState("");
  const navRef = useRef<HTMLElement | null>(null);
  const faqRefs = useRef<(HTMLDivElement | null)[]>([]);
  const quoteTimer = useRef<number | null>(null);

  // Intro overlay: CSS hides it at 2s; remove from the DOM at 2.9s.
  useEffect(() => {
    const t = window.setTimeout(() => setIntroGone(true), 2900);
    return () => window.clearTimeout(t);
  }, []);

  // Reveal on scroll, count-ups (only after the intro hands over ~2.5s),
  // and the nav's stronger shadow once the page scrolls.
  useEffect(() => {
    const revealAll = () => {
      document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
    };
    let io: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              (e.target as HTMLElement).classList.add("in");
              io?.unobserve(e.target);
            }
          });
        },
        { threshold: 0.05, rootMargin: "0px 0px 22% 0px" }
      );
      document.querySelectorAll(".reveal,#dashCard").forEach((el) => io?.observe(el));
      window.setTimeout(revealAll, 1500);
    } else {
      revealAll();
    }

    const animateCount = (el: Element) => {
      const target = parseFloat(el.getAttribute("data-count") || "");
      if (Number.isNaN(target)) return;
      const dec = parseInt(el.getAttribute("data-decimal") || "0", 10);
      const pre = el.getAttribute("data-prefix") || "";
      const suf = el.getAttribute("data-suffix") || "";
      let start: number | null = null;
      const dur = 1400;
      const step = (ts: number) => {
        if (start === null) start = ts;
        const p = Math.min((ts - start) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        const v = target * eased;
        el.textContent =
          pre + (dec ? v.toFixed(dec) : Math.round(v).toLocaleString("en-IN")) + suf;
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    let cio: IntersectionObserver | null = null;
    const startTimer = window.setTimeout(() => {
      cio = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              animateCount(e.target);
              cio?.unobserve(e.target);
            }
          });
        },
        { threshold: 0.4 }
      );
      document.querySelectorAll("[data-count]").forEach((el) => cio?.observe(el));
    }, 2500);

    const onScroll = () => {
      if (navRef.current) {
        navRef.current.style.boxShadow =
          window.scrollY > 10
            ? "0 16px 36px rgba(8,8,10,.11)"
            : "0 10px 30px rgba(8,8,10,.05)";
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io?.disconnect();
      cio?.disconnect();
      window.clearTimeout(startTimer);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // FAQ accordion height (first item open by default).
  useEffect(() => {
    faqRefs.current.forEach((item, i) => {
      if (!item) return;
      const a = item.querySelector(".faq-a") as HTMLElement | null;
      if (!a) return;
      a.style.maxHeight = i === faqOpen ? `${a.scrollHeight}px` : "0px";
    });
  }, [faqOpen]);

  const showQuote = (n: number) => {
    if (quoteTimer.current) window.clearTimeout(quoteTimer.current);
    setQuoteFading(true);
    quoteTimer.current = window.setTimeout(() => {
      setQi(((n % QUOTES.length) + QUOTES.length) % QUOTES.length);
      setQuoteFading(false);
    }, 230);
  };

  // Testimonials auto-advance every 7s.
  useEffect(() => {
    const id = window.setInterval(() => showQuote(qi + 1), 7000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qi]);

  // Pricing toggle (Monthly <-> Annual), with the amount bump animation.
  const onBilling = (e: MouseEvent<HTMLButtonElement>) => {
    const btn = e.currentTarget;
    const annual = !btn.classList.contains("on");
    btn.classList.toggle("on", annual);
    document.querySelectorAll(".amount").forEach((a) => {
      const el = a as HTMLElement;
      const from = parseInt(el.textContent || "0", 10) || 0;
      const to = parseInt(
        el.getAttribute(annual ? "data-annual" : "data-monthly") || "0",
        10
      );
      const price = el.parentElement as HTMLElement | null;
      if (price) {
        price.classList.remove("bump");
        void price.offsetWidth;
        price.classList.add("bump");
      }
      let st: number | null = null;
      const step = (ts: number) => {
        if (st === null) st = ts;
        const p = Math.min((ts - st) / 450, 1);
        el.textContent = String(
          Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)))
        );
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  };

  const onDemo = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setDemoMsg("Thanks — our team will reach out to schedule your demo.");
    e.currentTarget.reset();
  };

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Manrope:wght@400;500;600;700;800&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {!introGone && (
        <div id="intro" aria-hidden="true">
          <div className="mark">
            <Bolt size={52} />
          </div>
        </div>
      )}
    <div className="nav-wrap">
      <nav className="nav" ref={navRef}>
        <a className="logo" href="#"><span className="logo-mark"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.5H11L9.8 22 19 10h-6.5L13 2z"/></svg></span>GroundTruth</a>
        <div className={menuOpen ? "nav-links open" : "nav-links"} id="navLinks">
          <a href="#platform">Product</a><a href="#platform">Solutions</a><a href="#integrations">Resources</a><a href="#pricing">Pricing</a>
        </div>
        <div className="nav-actions">
          <a className="btn btn-outline" href="#pricing">Sign In</a>
          <a className="btn btn-blue" href="#pricing">Get Started</a>
          <button className="menu-btn" id="menuBtn" aria-label="Menu" onClick={() => setMenuOpen((v) => !v)}>☰</button>
        </div>
      </nav>
    </div>


    <header className="hero wrap">
      <div className="eyebrow">AI-Verified Talent Intelligence</div>
      <h1 className="split">
        <span className="line"><span className="inner">{letters("Turn Claims Into", 0)}</span></span>
        <span className="line"><span className="inner">{letters("Verified ", 17)}<span className="bolt-tile"><Bolt size={34} /></span>{letters(" Talent", 26)}</span></span>
      </h1>
      <div className="hero-mid">
        <div className="ghost ghost-left" aria-hidden="true">
          <svg className="ghost-wires" viewBox="0 0 120 134" fill="none" stroke="#D9DBE8" strokeWidth="1.6" strokeDasharray="1 5" strokeLinecap="round"><path d="M2 67 H52 Q66 67 66 40 V16 H104"/><path d="M2 67 H52 Q66 67 66 96 V118 H86"/></svg>
          <div className="ghost-play"><span className="play-dot">▶</span><span className="ghost-lines"><i></i><i className="short"></i></span></div>
          <div className="ghost-mini gm-mail">✉</div>
          <div className="ghost-mini gm-eye">◉</div>
        </div>
        <div className="ghost ghost-right" aria-hidden="true">
          <div className="ghost-perf">
            <div className="gp-head"><span>Evidence Check</span><span className="gp-live"><b>●</b> GitHub Verified</span></div>
            <div className="gp-row">128 claims · last 1 week</div>
            <span className="gp-badge">VERIFIED</span>
          </div>
        </div>
        <p className="hero-sub">Every skill backed by real evidence — GitHub,<br />coding records &amp; a code-grounded AI interview.</p>
        <div className="hero-cta">
          <a className="btn btn-blue" href="#pricing">Get Started</a>
          <a className="btn btn-ghost" href="#dashboard">Watch Demo <span className="play">▶</span></a>
        </div>
        <div className="faint-nums"><span data-count="5298">5,298</span><span data-count="9371">9,371</span></div>
      </div>

      <div className="hero-bottom">
        <div className="stat"><strong><i>▥</i><span data-count="100" data-suffix="%">100%</span></strong><span>Evidence-Backed Skills</span></div>
        <div className="logos"><span>GitHub</span><span>◆ LeetCode</span><span>Codeforces</span></div>
        <div className="stat"><strong><i>👥</i><span data-count="60" data-suffix=".0">60.0</span></strong><span>Match Threshold</span></div>
      </div>
    </header>


    <section id="dashboard">
      <div className="wrap">
        <div className="sec-head reveal">
          <div className="eyebrow">Verification Intelligence</div>
          <h2>Where Evidence<br />Meets <span className="blue">Intelligence</span></h2>
          <p>Every claim is checked against real third-party evidence — GitHub contributions, coding-platform records and certificates — and scored the same way for candidates and recruiters.</p>
        </div>

        <div className="dash reveal reveal-scale" id="dashCard">
          <div className="dash-top">
            <span className="logo"><span className="logo-mark"><svg viewBox="0 0 24 24" fill="currentColor" width="12"><path d="M13 2 4.5 13.5H11L9.8 22 19 10h-6.5L13 2z"/></svg></span>GroundTruth</span>
            <span className="search">⌕ &nbsp;Search</span><span className="spacer"></span>
            <span>🔔</span>
            <span><span className="avatar"></span> <b>Aarav Mehta</b><br /><small>aarav@groundtruth.ai</small></span>
            <a className="btn btn-blue" style={{ minHeight: "32px", padding: "0 14px" }} href="#pricing">+ Export</a>
          </div>
          <div className="dash-body">
            <aside className="sidebar">
              <small>MENU</small>
              <div className="active">▦ Overview</div><div>◎ AI Interviews</div><div>🔔 Alerts</div>
              <small>ANALYZE</small>
              <div>↗ Match Pipeline</div><div>▥ Evidence Insights</div><div>◎ Verification</div><div>◐ Score Breakdown</div>
              <small>GENERAL</small>
              <div>⬡ Integrations</div><div>👥 Team</div><div>⚙ Settings</div>
            </aside>
            <div className="dash-main">
              <h3>Welcome back, aarav</h3>
              <p>Your verified evidence is trending upward this week.</p>
              <div className="kpis">
                <div className="kpi"><label>▥ Evidence Score</label><strong><span data-count="88.4" data-decimal="1">88.4</span><em>↗ 8.4%</em></strong><svg className="mini-chart" viewBox="0 0 120 34" preserveAspectRatio="none"><path className="spark" pathLength="100" d="M0 24 L15 16 L28 20 L42 10 L58 18 L74 8 L90 14 L106 6 L120 10" fill="none" stroke="#2F4BFF" strokeWidth="2"/></svg></div>
                <div className="kpi"><label>♡ Verified Skills</label><strong>+<span data-count="128">128</span><em>↗ 6.1%</em></strong><svg className="mini-chart" viewBox="0 0 120 34"><rect className="bar" style={{ animationDelay: ".15s" }} x="8" y="14" width="14" height="20" rx="3" fill="#DDE1FF"/><rect className="bar" style={{ animationDelay: ".27s" }} x="30" y="8" width="14" height="26" rx="3" fill="#2F4BFF"/><rect className="bar" style={{ animationDelay: ".39s" }} x="52" y="16" width="14" height="18" rx="3" fill="#DDE1FF"/><rect className="bar" style={{ animationDelay: ".51s" }} x="74" y="10" width="14" height="24" rx="3" fill="#B9C4FF"/><rect className="bar" style={{ animationDelay: ".63s" }} x="96" y="18" width="14" height="16" rx="3" fill="#E4E7FF"/></svg></div>
                <div className="kpi"><label>⬡ Match Score</label><strong><span data-count="86.2" data-decimal="1">86.2</span><em>↗ 4.8%</em></strong><svg className="mini-chart" viewBox="0 0 120 34"><path d="M10 30 A50 50 0 0 1 110 30" fill="none" stroke="#E6E9FF" strokeWidth="7" strokeLinecap="round"/><path className="gauge-arc" pathLength="100" d="M10 30 A50 50 0 0 1 82 12" fill="none" stroke="#2F4BFF" strokeWidth="7" strokeLinecap="round"/></svg></div>
                <div className="kpi"><label>◎ Interview Score</label><strong><span data-count="84.6" data-decimal="1">84.6</span>%<em>↗ 3.2%</em></strong><div style={{ display: "flex", gap: "6px", marginTop: "10px" }}><span className="wbar" style={{ flex: "1.4", height: "30px", borderRadius: "7px", background: "#7C8CFF", animationDelay: ".2s" }}></span><span className="wbar" style={{ flex: "1", height: "30px", borderRadius: "7px", background: "#C9D1FF", animationDelay: ".35s" }}></span><span className="wbar" style={{ flex: ".6", height: "30px", borderRadius: "7px", background: "#E1E6FF", animationDelay: ".5s" }}></span></div></div>
              </div>
              <div className="dash-grid">
                <div className="panel">
                  <h4>Match Score Trends</h4>
                  <p>Cohort progression &nbsp;·&nbsp; Rank-Fusion Score</p>
                  <svg className="chart-svg" viewBox="0 0 520 150" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="ltFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2F4BFF" stopOpacity=".16"/><stop offset="1" stopColor="#2F4BFF" stopOpacity="0"/></linearGradient>
                    </defs>
                    <g stroke="#EEF0FF" strokeWidth="1"><line x1="0" y1="38" x2="520" y2="38"/><line x1="0" y1="76" x2="520" y2="76"/><line x1="0" y1="114" x2="520" y2="114"/></g>
                    <path className="chart-area" d="M0 118 C60 104 90 78 140 84 C190 90 220 52 280 58 C340 64 380 34 440 28 L520 16 L520 150 L0 150 Z" fill="url(#ltFill)"/>
                    <path className="chart-line" d="M0 118 C60 104 90 78 140 84 C190 90 220 52 280 58 C340 64 380 34 440 28 L520 16" fill="none" stroke="#2F4BFF" strokeWidth="2.5"/>
                    <path d="M0 128 C80 122 160 108 260 100 C360 92 440 78 520 66" fill="none" stroke="#B9BED6" strokeWidth="2" strokeDasharray="5 5" opacity=".7"/>
                  </svg>
                </div>
                <div className="panel">
                  <h4>✦ AI Suggestions</h4>
                  <div className="sugg" style={{ animationDelay: ".55s" }}><i>⬡</i><div><b>Prioritize verified React candidate</b><span>Strong GitHub evidence across 4 verified repositories.</span></div></div>
                  <div className="sugg" style={{ animationDelay: ".72s" }}><i>↗</i><div><b>Shortlist top-matched candidates</b><span>5 candidates above the 60.0 match threshold this week.</span></div></div>
                  <div className="sugg" style={{ animationDelay: ".89s" }}><i>◎</i><div><b>Invite candidate to AI interview</b><span>Profile interview unlocks discoverability and matching.</span></div></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>


    <section id="platform">
      <div className="wrap">
        <div className="sec-head reveal">
          <div className="eyebrow">Platform Capabilities</div>
          <h2>Verification Built for<br />Modern Hiring Teams</h2>
          <p>GroundTruth unifies evidence from GitHub, coding platforms, certificates and AI interviews to deliver verified skills, trusted scores, and two-way matching.</p>
        </div>

        <div className="big-card reveal reveal-scale">
          <div><h3>Unified Evidence Layer</h3><p>Aggregate GitHub contributions, coding records, certificates and interview answers into one evidence layer — eliminating inflated resumes and unverifiable claims.</p></div>
          <div className="hub">
            <div className="hub-icon" style={{ left: "16%", top: "16%" }}>✉</div>
            <div className="hub-icon" style={{ right: "16%", top: "16%" }}>📣</div>
            <div className="hub-icon" style={{ left: "8%", top: "44%" }}>▦</div>
            <div className="hub-icon" style={{ right: "8%", top: "44%" }}>⬡</div>
            <div className="hub-icon" style={{ left: "22%", bottom: "12%" }}>↗</div>
            <div className="hub-icon" style={{ right: "22%", bottom: "12%" }}>◎</div>
            <span className="sig-dot sd1"></span><span className="sig-dot sd2"></span>
            <div className="hub-center"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.5H11L9.8 22 19 10h-6.5L13 2z"/></svg></div>
            <div className="hub-tag">Unified Evidence Layer</div>
          </div>
        </div>

        <div className="cards3">
          <article className="cap reveal">
            <div className="cap-preview">
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "700" }}><span>Live Verification Stream</span><span className="live-dot"></span></div>
              <div className="alert-box"><b>✓ GitHub Claim Verified</b><p style={{ color: "var(--muted)", fontSize: "11px", lineHeight: "1.5", marginTop: "4px" }}>Contribution share and detected technologies confirmed from the candidate&rsquo;s real repository history.</p><p style={{ marginTop: "8px", color: "var(--muted)", fontSize: "11px" }}>GitHub · 2m ago · <span style={{ color: "var(--blue)", fontWeight: "700" }}>Status VERIFIED</span></p></div>
            </div>
            <h3>Real-Time Evidence Verification</h3>
          </article>
          <article className="cap reveal d1">
            <div className="cap-preview">
              <p style={{ textAlign: "center", color: "var(--muted)", fontWeight: "700", fontSize: "11px" }}>AI INTERVIEW SCORE</p>
              <div className="big-num"><span data-count="87.4" data-decimal="1">87.4</span></div>
              <p style={{ textAlign: "center", color: "#16A36A", fontWeight: "700", fontSize: "11px", marginTop: "4px" }}>Scored on a 5-dimension rubric</p>
              <p style={{ textAlign: "center", color: "var(--muted)", fontSize: "11px", marginTop: "14px" }}>Technical 30% · Code 25% · Solving 20%</p>
            </div>
            <h3>Code-Grounded AI Interviews</h3>
          </article>
          <article className="cap reveal d2">
            <div className="cap-preview">
              <p style={{ fontWeight: "700", fontSize: "11px" }}>✦ The same score, shown to both sides.</p>
              <p style={{ fontWeight: "800", marginTop: "12px" }}>Rank Fusion <span style={{ color: "#16A36A", fontSize: "11px" }}>LIVE</span></p>
              <div style={{ display: "flex", justifyContent: "space-around", marginTop: "16px", textAlign: "center" }}><div><b style={{ color: "#16A36A" }}>0.40</b><br /><small style={{ color: "var(--muted)" }}>Semantic</small></div><div><b>0.25</b><br /><small style={{ color: "var(--muted)" }}>Evidence</small></div><div><b style={{ color: "#16A36A" }}>0.15</b><br /><small style={{ color: "var(--muted)" }}>Interview</small></div></div>
            </div>
            <h3>Two-Way Rank-Fusion Matching</h3>
          </article>
        </div>
      </div>
    </section>


    <section id="integrations" className="integrations">
      <svg className="waves" viewBox="0 0 1440 640" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="#AEB4E2" strokeWidth="1">
        <path d="M-40 470 C240 330 430 560 720 430 C1010 300 1200 520 1480 380"/>
        <path d="M-40 448 C240 308 430 538 720 408 C1010 278 1200 498 1480 358" opacity=".85"/>
        <path d="M-40 426 C240 286 430 516 720 386 C1010 256 1200 476 1480 336" opacity=".8"/>
        <path d="M-40 404 C240 264 430 494 720 364 C1010 234 1200 454 1480 314" opacity=".75"/>
        <path d="M-40 382 C240 242 430 472 720 342 C1010 212 1200 432 1480 292" opacity=".7"/>
        <path d="M-40 360 C240 220 430 450 720 320 C1010 190 1200 410 1480 270" opacity=".65"/>
        <path d="M-40 338 C240 198 430 428 720 298 C1010 168 1200 388 1480 248" opacity=".6"/>
        <path d="M-40 316 C240 176 430 406 720 276 C1010 146 1200 366 1480 226" opacity=".55"/>
        <path d="M-40 294 C240 154 430 384 720 254 C1010 124 1200 344 1480 204" opacity=".5"/>
        <path d="M-40 272 C240 132 430 362 720 232 C1010 102 1200 322 1480 182" opacity=".45"/>
        <path d="M-40 250 C240 110 430 340 720 210 C1010 80 1200 300 1480 160" opacity=".4"/>
        <path d="M-40 492 C240 352 430 582 720 452 C1010 322 1200 542 1480 402" opacity=".9"/>
        <path d="M-40 514 C240 374 430 604 720 474 C1010 344 1200 564 1480 424" opacity=".8"/>
        <path d="M-40 536 C240 396 430 626 720 496 C1010 366 1200 586 1480 446" opacity=".7"/>
        <path d="M-40 558 C240 418 430 648 720 518 C1010 388 1200 608 1480 468" opacity=".6"/>
        <path d="M-40 580 C240 440 430 670 720 540 C1010 410 1200 630 1480 490" opacity=".5"/>
      </g></svg>
      <div className="wrap">
        <div className="sec-head reveal">
          <div className="eyebrow">Integrations</div>
          <h2>Works With Your<br />Hiring Stack</h2>
          <p>Connects to your existing code, coding and hiring<br />tools — no migration required.</p>
        </div>
        <div className="logo-grid reveal">
          <div className="logo-tile" style={{ "--n": "0" } as CSSProperties} title="GitHub"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="19" fill="#24292F"/><text x="24" y="29.5" textAnchor="middle" fontFamily="Manrope,sans-serif" fontSize="11" fontWeight="800" fill="#fff">&lt;/&gt;</text></svg></div>
          <div className="logo-tile" style={{ "--n": "1" } as CSSProperties} title="LeetCode"><svg viewBox="0 0 48 48"><rect x="6" y="6" width="36" height="36" rx="9" fill="#FFA116"/><text x="24" y="30.5" textAnchor="middle" fontFamily="Manrope,sans-serif" fontSize="15" fontWeight="800" fill="#fff">LC</text></svg></div>
          <div className="logo-tile" style={{ "--n": "2" } as CSSProperties} title="Codeforces"><svg viewBox="0 0 48 48"><rect x="8" y="24" width="8" height="16" rx="2" fill="#F44336"/><rect x="20" y="16" width="8" height="24" rx="2" fill="#2196F3"/><rect x="32" y="8" width="8" height="32" rx="2" fill="#FFC107"/></svg></div>
          <div className="logo-tile" style={{ "--n": "3" } as CSSProperties} title="Google Gemini"><svg viewBox="0 0 48 48"><defs><linearGradient id="gmG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4796E3"/><stop offset=".5" stopColor="#9177C7"/><stop offset="1" stopColor="#D96570"/></linearGradient></defs><path d="M24 5c1.2 9.5 4.8 14.8 19 19-14.2 4.2-17.8 9.5-19 19-1.2-9.5-4.8-14.8-19-19C19.2 19.8 22.8 14.5 24 5z" fill="url(#gmG)"/></svg></div>
          <div className="logo-tile" style={{ "--n": "4" } as CSSProperties} title="PostgreSQL"><svg viewBox="0 0 48 48"><rect x="6" y="6" width="36" height="36" rx="9" fill="#336791"/><text x="24" y="30.5" textAnchor="middle" fontFamily="Manrope,sans-serif" fontSize="14" fontWeight="800" fill="#fff">Pg</text></svg></div>
          <div className="logo-tile" style={{ "--n": "5" } as CSSProperties} title="Redis"><svg viewBox="0 0 48 48"><path d="M24 6 42 16 24 26 6 16Z" fill="#D82C20"/><path d="M10 23.5 24 30.5l14-7V32L24 39 10 32Z" fill="#A41E11"/><circle cx="31.5" cy="16" r="2.4" fill="#fff"/></svg></div>
          <div className="logo-tile" style={{ "--n": "6" } as CSSProperties} title="Docker"><svg viewBox="0 0 48 48"><g fill="#2496ED"><rect x="8" y="20" width="8" height="8" rx="1.5"/><rect x="18" y="20" width="8" height="8" rx="1.5"/><rect x="28" y="20" width="8" height="8" rx="1.5"/><rect x="18" y="10" width="8" height="8" rx="1.5"/><rect x="28" y="10" width="8" height="8" rx="1.5"/></g><path d="M6 32h36c-1 6-5 9.5-11 9.5H17C11 41.5 7 38 6 32z" fill="#2496ED" opacity=".5"/></svg></div>
          <div className="logo-tile" style={{ "--n": "7" } as CSSProperties} title="Gmail"><svg viewBox="0 0 48 48"><rect x="7" y="12" width="34" height="25" rx="4" fill="#fff" stroke="#E3E5EA" strokeWidth="1.6"/><path d="M10 16l14 10.5L38 16" fill="none" stroke="#EA4335" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M10 35V17" stroke="#4285F4" strokeWidth="3.2" strokeLinecap="round"/><path d="M38 35V17" stroke="#34A853" strokeWidth="3.2" strokeLinecap="round"/></svg></div>
          <div className="logo-tile" style={{ "--n": "8" } as CSSProperties} title="LinkedIn"><svg viewBox="0 0 48 48"><rect x="6" y="6" width="36" height="36" rx="5" fill="#0A66C2"/><text x="24" y="32.5" textAnchor="middle" fontFamily="Manrope,sans-serif" fontSize="17" fontWeight="800" fill="#fff">in</text></svg></div>
          <div className="logo-tile" style={{ "--n": "9" } as CSSProperties} title="Slack"><svg viewBox="0 0 48 48"><path d="M20.5 7a5 5 0 0 1 5 5v7h-7a5 5 0 0 1-5-5 5 5 0 0 1 7-7z" fill="#36C5F0" transform="rotate(90 24 24)"/><path d="M41 20.5a5 5 0 0 1-5 5h-7v-7a5 5 0 0 1 5-5 5 5 0 0 1 7 7z" fill="#2EB67D" transform="rotate(90 24 24)"/><path d="M27.5 41a5 5 0 0 1-5-5v-7h7a5 5 0 0 1 5 5 5 5 0 0 1-7 7z" fill="#ECB22E" transform="rotate(90 24 24)"/><path d="M7 27.5a5 5 0 0 1 5-5h7v7a5 5 0 0 1-5 5 5 5 0 0 1-7-7z" fill="#E01E5A" transform="rotate(90 24 24)"/></svg></div>
          <div className="logo-tile" style={{ "--n": "10" } as CSSProperties} title="AWS S3"><svg viewBox="0 0 48 48"><rect x="6" y="6" width="36" height="36" rx="8" fill="#FF9900"/><text x="24" y="31" textAnchor="middle" fontFamily="Manrope,sans-serif" fontSize="15" fontWeight="800" fill="#fff">S3</text></svg></div>
        </div>
        <div className="center-btn reveal"><a className="btn btn-ghost" href="#pricing" style={{ borderRadius: "10px" }}>Explore Integrations <span style={{ color: "var(--blue2)", fontWeight: "800" }}>↗</span></a></div>
      </div>
    </section>


    <section id="pricing">
      <div className="wrap">
        <div className="sec-head reveal">
          <div className="eyebrow">Pricing</div>
          <h2>Flexible Plans<br />for Hiring Teams</h2>
          <div className="toggle-row"><span>Monthly</span><button className="toggle" id="billingToggle" aria-label="Toggle annual billing" onClick={onBilling}></button><span>Annual</span><span className="off">10% OFF</span></div>
        </div>
        <div className="price-grid">
          <article className="price-card reveal">
            <div className="price-head"><h3>◎ Basic Plan</h3><p>For growing teams hiring on verified evidence.</p></div>
            <div className="price">$<span className="amount" data-monthly="79" data-annual="71">79</span> <span>/ month</span></div>
            <ul><li>Unified evidence dashboard</li><li>Real-time verification monitoring</li><li>AI interview &amp; match insights</li></ul>
            <a className="btn btn-ghost" href="#faq">Upgrade Now</a>
          </article>
          <article className="price-card featured reveal d1">
            <div className="best">BEST VALUE</div>
            <div className="price-head"><h3>⬡ Enterprise Plan</h3><p>Advanced verification for scaling hiring organizations.</p></div>
            <div className="price">$<span className="amount" data-monthly="115" data-annual="103">115</span> <span>/ month</span></div>
            <ul><li>Rank-fusion matching engine</li><li>Advanced AI interview recommendations</li><li>Dedicated support &amp; custom integrations</li></ul>
            <a className="btn btn-blue" href="#faq">Upgrade Now</a>
          </article>
        </div>
      </div>
    </section>


    <section>
      <div className="wrap">
        <div className="testi">
          <div className="reveal reveal-left">
            <div className="eyebrow">Testimonials</div>
            <h2>Trusted by<br />Hiring Teams</h2>
            <div className="testi-stats">
              <div><strong><span data-count="42">42</span>%</strong><span>Faster Shortlisting Cycle</span></div>
              <div><strong><span data-count="3.1" data-decimal="1">3.1</span>x</strong><span>Match Quality Improvement</span></div>
            </div>
          </div>
          <div className="quote-card reveal reveal-right d1">
            <div className="quote-count" id="quoteCount">{`0${qi + 1} / 03`}</div>
            <p className="quote-text" id="quoteText" style={{ opacity: quoteFading ? 0 : 1, transform: quoteFading ? "translateX(-16px)" : "translateX(0)", transition: "opacity .3s ease, transform .3s ease" }}>{QUOTES[qi].t}</p>
            <div className="quote-foot">
              <div className="person"><span className="avatar"></span><div><b id="quoteRole">{QUOTES[qi].r}</b><span id="quoteCompany">{QUOTES[qi].c}</span></div></div>
              <div className="arrows"><button id="prevQuote" aria-label="Previous testimonial" onClick={() => showQuote(qi - 1)}>←</button><button id="nextQuote" aria-label="Next testimonial" onClick={() => showQuote(qi + 1)}>→</button></div>
            </div>
          </div>
        </div>
      </div>
    </section>


    <section id="faq">
      <div className="wrap">
        <div className="sec-head reveal"><div className="eyebrow">FAQ</div><h2>Frequently Asked Questions</h2></div>
        <div className="faq-list reveal" id="faqList">
          {FAQS.map((f, i) => (
            <div
              key={i}
              ref={(el) => { faqRefs.current[i] = el; }}
              className={i === faqOpen ? "faq-item open" : "faq-item"}
            >
              <button className="faq-q" onClick={() => setFaqOpen(i === faqOpen ? -1 : i)}>
                <span className="faq-icon">{f.icon}</span>{f.q}<span className="chev">{i === faqOpen ? "⌃" : "⌄"}</span>
              </button>
              <div className="faq-a"><p>{f.a}</p></div>
            </div>
          ))}
        </div>
        <div className="cta-bar reveal">
          <div><b>Still have questions?</b><p>Speak with our team to see how GroundTruth fits your hiring process.</p></div>
          <a className="btn btn-blue" href="#footer-demo">Contact Us</a>
        </div>
      </div>
    </section>


    <footer>
      <div className="wrap">
        <div className="foot reveal reveal-scale">
          <div className="foot-blue">
            <a className="logo" href="#"><span className="logo-mark"><svg viewBox="0 0 24 24" fill="currentColor" width="16"><path d="M13 2 4.5 13.5H11L9.8 22 19 10h-6.5L13 2z"/></svg></span>GroundTruth</a>
            <p>Proof over claims, powered by verified evidence.</p>
            <div className="socials"><a href="#" aria-label="Facebook">f</a><a href="#" aria-label="X">𝕏</a><a href="#" aria-label="Instagram">◎</a><a href="#" aria-label="LinkedIn">in</a></div>
          </div>
          <div>
            <div className="foot-cols">
              <div><h4>Product</h4><a href="#platform">Evidence Layer</a><a href="#platform">GitHub Verification</a><a href="#platform">AI Interviews</a><a href="#platform">Smart Apply</a><a href="#platform">API Access</a></div>
              <div><h4>Resources</h4><a href="#integrations">Documentation</a><a href="#integrations">Case Studies</a><a href="#integrations">Blog</a><a href="#integrations">Security</a><a href="#integrations">Status</a></div>
            </div>
            <p className="copy" style={{ paddingLeft: "10px" }}>© Copyright 2026 GroundTruth</p>
          </div>
          <div className="foot-right" id="footer-demo">
            <p>Proof over claims, powered by verified evidence.</p>
            <form className="demo-form" id="demoForm" onSubmit={onDemo}><input type="email" required placeholder="Enter your work email..." aria-label="Work email" /><button className="btn btn-blue" type="submit">Get a Demo</button></form>
            <p id="demoMsg" style={{ fontSize: "13px", color: "var(--blue)", fontWeight: "700", marginTop: "10px", minHeight: "18px" }}>{demoMsg}</p>
          </div>
        </div>
        <p className="foot-note">GroundTruth AI — AI-Verified Talent Intelligence</p>
      </div>
    </footer>
    </>
  );
}
