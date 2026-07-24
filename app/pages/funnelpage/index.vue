<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'

const year = new Date().getFullYear()
const isDark = ref(false)
const menuOpen = ref(false)
let revealObserver

const goal = 'Our goal in developing the DJA Payroll Management System is to replace manual, paper-based payroll work with a single digital platform—one that computes salaries accurately, keeps employee records organized, and gives DJA Group of Companies a secure, dependable way to run payroll every cycle.'

const features = [
  { title: 'Payroll processing', desc: 'Compute salaries, overtime, and deductions automatically, then release accurate payslips every cutoff.', icon: 'payroll' },
  { title: 'Attendance tracking', desc: 'Log time-ins, absences, and leave credits, synced directly into every pay run.', icon: 'attendance' },
  { title: 'Employee records', desc: 'Keep contracts, government IDs, and employment history organized in one place.', icon: 'records' },
  { title: 'Secure access', desc: 'Role-based permissions ensure only authorized staff can view or edit payroll data.', icon: 'security' },
  { title: 'Reports & summaries', desc: 'Generate payroll and attendance reports ready for management review.', icon: 'reports' }
]

onMounted(() => {
  const saved = localStorage.getItem('dja-theme')
  isDark.value = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches

  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add('is-visible'))
  }, { threshold: 0.14 })
  document.querySelectorAll('.reveal').forEach((element) => revealObserver.observe(element))
})

onBeforeUnmount(() => revealObserver?.disconnect())
watch(isDark, (value) => localStorage.setItem('dja-theme', value ? 'dark' : 'light'))

function toggleTheme() { isDark.value = !isDark.value }
function closeMenu() { menuOpen.value = false }
</script>

<template>
  <div class="page" :data-theme="isDark ? 'dark' : 'light'">
    <header class="header">
      <div class="shell header__row">
        <a href="#home" class="brand" @click="closeMenu">
          <img src="/images/logo.png" alt="DJA Group of Companies" class="brand__logo" />
          <span class="brand__name">DJA <small>Group of Companies</small></span>
        </a>

        <nav class="nav" :class="{ 'nav--open': menuOpen }" aria-label="Primary">
          <a href="#home" @click="closeMenu">Home</a>
          <a href="#about" @click="closeMenu">About</a>
          <a href="#features" @click="closeMenu">Features</a>
          <NuxtLink to="/loginscreen" class="nav__mobile-link" @click="closeMenu">Log in</NuxtLink>
          <NuxtLink to="/signupscreen" class="nav__mobile-cta" @click="closeMenu">Get started</NuxtLink>
        </nav>

        <div class="header__actions">
          <button type="button" class="theme-toggle" :aria-pressed="isDark" aria-label="Toggle dark mode" @click="toggleTheme">
            <svg v-if="!isDark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" /></svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7Z" /></svg>
          </button>
          <NuxtLink to="/loginscreen" class="btn btn--ghost header__desktop-action">Login</NuxtLink>
          <NuxtLink to="/signupscreen" class="btn btn--solid header__desktop-action">Signup <span>→</span></NuxtLink>
          <button type="button" class="menu-toggle" :aria-expanded="menuOpen" aria-label="Toggle navigation" @click="menuOpen = !menuOpen"><i></i><i></i></button>
        </div>
      </div>
    </header>

    <main>
      <section id="home" class="hero shell">
        <div class="hero__copy reveal is-visible">
          <span class="eyebrow"><i></i> Payroll, attendance &amp; records</span>
          <h1>Payroll management,<br /><em>made effortless.</em></h1>
          <p class="lede">A centralized platform for DJA Group of Companies to manage payroll, attendance, and employee records with confidence.</p>
          <div class="hero__cta">
            <NuxtLink to="/signupscreen" class="btn btn--solid btn--lg">Get started <span>→</span></NuxtLink>
            <a href="#features" class="text-link">Explore features <span>↓</span></a>
          </div>
          <div class="trust-row"><span class="trust-dot">✓</span> Built for accurate, secure payroll operations</div>
        </div>

        <div class="hero__visual reveal">
          <div class="visual-orbit orbit--one"></div><div class="visual-orbit orbit--two"></div>
          <div class="dashboard-card">
            <div class="dashboard-card__top"><span class="dashboard-logo">DJA</span><span class="status"><i></i> Payroll ready</span></div>
            <p class="dash-label">Payroll overview</p><strong>₱ 248,500.00</strong>
            <div class="dash-chart"><i style="height:42%"></i><i style="height:62%"></i><i style="height:48%"></i><i style="height:78%"></i><i style="height:66%"></i><i style="height:92%"></i><i style="height:72%"></i></div>
            <div class="dash-bottom"><span><b>42</b> Employees</span><span><b>100%</b> Processed</span></div>
          </div>
          <img src="/images/groupic.png" alt="DJA Group team" class="hero__image" />
          <div class="float-card float-card--pay"><span>✓</span><div><small>Latest payroll</small><b>Successfully processed</b></div></div>
          <div class="float-card float-card--people"><b>42</b><small>active employees</small></div>
        </div>
      </section>

      <section id="about" class="about shell reveal">
        <div class="section-heading"><span class="section-kicker">01 — About DJA</span><h2>One dependable system<br />for your <em>entire team.</em></h2></div>
        <div class="about__content"><p>The DJA Payroll Management System was built to replace scattered, paper-based payroll work with a simpler and more reliable way to operate.</p><p>Designed around accuracy, security, and ease of use, it keeps employee information and payroll data organized—so administrators can focus on what matters.</p><a href="#features" class="text-link">See what it can do <span>→</span></a></div>
      </section>

      <section class="goal shell reveal">
        <div class="goal__art"><div class="image-frame"><img src="/images/payrollwithlaptop.png" alt="Payroll dashboard on a laptop" /></div><div class="goal__badge"><span>01</span><p><b>Accurate by design</b>Every payroll cycle</p></div></div>
        <div class="goal__copy"><span class="section-kicker">02 — Our purpose</span><h2>Clearer processes.<br /><em>Better decisions.</em></h2><p>{{ goal }}</p><div class="goal__line"></div></div>
      </section>

      <section id="features" class="features">
        <div class="shell"><div class="features__head reveal"><span class="section-kicker">03 — What we offer</span><h2>Everything payroll needs,<br /><em>in one place.</em></h2><p>Built to make each cutoff more accurate, organized, and easy to manage.</p></div>
          <ul class="feature-grid">
            <li v-for="(feature, index) in features" :key="feature.title" class="feature-card reveal" :style="{ '--delay': `${index * 85}ms` }"><span class="feature-number">0{{ index + 1 }}</span><span class="feature-card__icon">
              <svg v-if="feature.icon === 'payroll'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2.5" y="6.5" width="19" height="11" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5h.01M18 14.5h.01"/></svg>
              <svg v-else-if="feature.icon === 'attendance'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M8.5 14l2.2 2.2L15.5 12"/></svg>
              <svg v-else-if="feature.icon === 'records'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 6.5a1.5 1.5 0 0 1 1.5-1.5H9l2 2.2h8a1.5 1.5 0 0 1 1.5 1.5v9.3a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z"/></svg>
              <svg v-else-if="feature.icon === 'security'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 2.8 19.5 6v5.6c0 4.7-3.2 8.4-7.5 10.1-4.3-1.7-7.5-5.4-7.5-10.1V6Z"/><path d="M8.8 12.2l2.1 2.1 4.3-4.4"/></svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 20.5h18"/><rect x="5.5" y="12.5" width="3.4" height="8"/><rect x="10.6" y="8" width="3.4" height="12.5"/><rect x="15.7" y="4.5" width="3.4" height="16"/></svg>
            </span><h3>{{ feature.title }}</h3><p>{{ feature.desc }}</p><span class="card-arrow">↗</span></li>
          </ul>
        </div>
      </section>

      <section class="cta shell reveal"><div><span class="section-kicker">Ready when you are</span><h2>Make your next payroll<br /><em>your easiest one yet.</em></h2></div><NuxtLink to="/signupscreen" class="btn btn--light btn--lg">Create an account <span>→</span></NuxtLink></section>
    </main>

    <footer class="footer"><div class="shell footer__row"><a href="#home" class="brand"><img src="/images/logo.png" alt="" class="brand__logo" /><span class="brand__name">DJA <small>Group of Companies</small></span></a><span>© {{ year }} DJA Group of Companies</span><div class="footer__links"><a href="#about">About</a><a href="#features">Features</a><NuxtLink to="/loginscreen">Login</NuxtLink></div></div></footer>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,600;0,700;1,600;1,700&display=swap');
.page { --navy:#142b5e; --blue:#2463d4; --paper:#f9fafc; --surface:#fff; --ink:#132047; --muted:#66718b; --line:#e5e9f1; --soft:#edf3ff; --accent:#2363d6; --glow:#dceaff; min-height:100vh; overflow:hidden; background:var(--paper); color:var(--ink); font-family:'DM Sans',sans-serif; transition:background .3s,color .3s; }
.page[data-theme='dark'] { --paper:#0d1529; --surface:#15203a; --ink:#eef3ff; --muted:#aab7d0; --line:#283652; --soft:#1a315c; --accent:#79a7ff; --glow:#14294e; }
* { box-sizing:border-box; } html { scroll-behavior:smooth; } a { color:inherit; text-decoration:none; } h1,h2,h3,p { margin:0; } h1,h2 { letter-spacing:-.045em; line-height:1.05; } h1 { font-size:clamp(2.9rem,5.2vw,5rem); } h2 { font-size:clamp(2.25rem,4vw,3.55rem); } h1 em,h2 em { color:var(--accent); font-family:'Playfair Display',serif; font-weight:600; } .shell { width:min(1160px,100%); margin:auto; padding-inline:28px; }
.header { position:sticky; top:0; z-index:50; border-bottom:1px solid color-mix(in srgb,var(--line) 70%,transparent); background:color-mix(in srgb,var(--paper) 85%,transparent); backdrop-filter:blur(18px); } .header__row { min-height:76px; display:flex; align-items:center; justify-content:space-between; gap:24px; } .brand { display:inline-flex; align-items:center; gap:10px; font-weight:700; letter-spacing:-.03em; } .brand__logo { width:38px; height:38px; object-fit:contain; } .brand__name { font-size:1.02rem; line-height:1; } .brand small { display:block; margin-top:4px; color:var(--muted); font-size:.62rem; font-weight:600; letter-spacing:.01em; }
.nav { display:flex; gap:30px; align-items:center; color:var(--muted); font-size:.91rem; font-weight:600; } .nav a { position:relative; } .nav > a:not(.nav__mobile-link):not(.nav__mobile-cta)::after { content:''; position:absolute; bottom:-7px; left:0; width:0; height:2px; background:var(--accent); transition:width .2s; } .nav > a:hover::after { width:100%; } .header__actions { display:flex; align-items:center; gap:10px; }.btn { border:1px solid transparent; display:inline-flex; align-items:center; justify-content:center; gap:9px; border-radius:8px; padding:10px 17px; font-size:.9rem; font-weight:700; transition:transform .2s,box-shadow .2s,background .2s; }.btn span { font-size:1.15em; }.btn:hover { transform:translateY(-2px); }.btn--solid { color:#fff; background:var(--accent); box-shadow:0 10px 22px color-mix(in srgb,var(--accent) 25%,transparent); }.btn--solid:hover { box-shadow:0 14px 28px color-mix(in srgb,var(--accent) 36%,transparent); }.btn--ghost { border-color:var(--line); }.btn--lg { padding:14px 22px; font-size:.96rem; }.theme-toggle,.menu-toggle { border:1px solid var(--line); background:var(--surface); color:var(--ink); display:grid; place-items:center; cursor:pointer; }.theme-toggle { width:38px; height:38px; border-radius:50%; }.theme-toggle svg { width:18px; }.menu-toggle,.nav__mobile-link,.nav__mobile-cta { display:none; }
.hero { min-height:650px; display:grid; grid-template-columns:.94fr 1.06fr; align-items:center; gap:44px; padding-block:76px 72px; }.eyebrow,.section-kicker { display:inline-flex; align-items:center; gap:8px; color:var(--accent); font-size:.71rem; letter-spacing:.11em; text-transform:uppercase; font-weight:700; }.eyebrow { padding:8px 11px; background:var(--soft); border-radius:5px; margin-bottom:22px; }.eyebrow i { width:6px; height:6px; background:var(--accent); border-radius:50%; box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 16%,transparent); }.lede { max-width:52ch; margin-top:24px; color:var(--muted); font-size:1.04rem; line-height:1.75; }.hero__cta { display:flex; align-items:center; gap:24px; margin-top:30px; }.text-link { display:inline-flex; gap:8px; align-items:center; color:var(--ink); font-size:.9rem; font-weight:700; }.text-link span { color:var(--accent); transition:transform .2s; }.text-link:hover span { transform:translateX(4px); }.trust-row { display:flex; align-items:center; gap:8px; margin-top:32px; color:var(--muted); font-size:.78rem; font-weight:600; }.trust-dot { display:grid; place-items:center; width:20px; height:20px; border-radius:50%; color:#fff; background:#42a779; font-size:.66rem; }
.hero__visual { position:relative; min-height:420px; }.hero__image { position:absolute; right:0; bottom:8px; width:83%; height:78%; object-fit:cover; object-position:center; border-radius:8px 8px 78px 8px; box-shadow:22px 25px 0 var(--glow),0 25px 45px rgba(13,28,62,.15); }.visual-orbit { position:absolute; border:1px solid color-mix(in srgb,var(--accent) 22%,transparent); border-radius:50%; }.orbit--one { width:460px; height:460px; right:-90px; top:-45px; }.orbit--two { width:365px; height:365px; right:-42px; top:4px; border-style:dashed; animation:spin 24s linear infinite; }.dashboard-card { position:absolute; z-index:2; top:8px; left:0; width:246px; padding:17px; border:1px solid rgba(255,255,255,.7); border-radius:10px; color:#15234c; background:rgba(255,255,255,.95); box-shadow:0 18px 42px rgba(17,38,88,.17); animation:float 5s ease-in-out infinite; }.dashboard-card__top,.dash-bottom { display:flex; align-items:center; justify-content:space-between; }.dashboard-logo { font-size:.72rem; font-weight:800; color:#fff; padding:5px 7px; border-radius:4px; background:#173573; }.status { font-size:.59rem; font-weight:700; }.status i { display:inline-block; width:6px; height:6px; margin-right:3px; border-radius:50%; background:#43ae79; }.dash-label { margin-top:18px; color:#7b86a0; font-size:.64rem; }.dashboard-card strong { display:block; margin-top:3px; font-size:1.25rem; letter-spacing:-.04em; }.dash-chart { height:58px; display:flex; align-items:end; gap:7px; margin:14px 0; border-bottom:1px solid #e5eaf4; }.dash-chart i { display:block; flex:1; border-radius:3px 3px 0 0; background:linear-gradient(#72a0f4,#2d61ca); }.dash-bottom { color:#7b86a0; font-size:.59rem; }.dash-bottom b { display:block; color:#172852; font-size:.75rem; }.float-card { position:absolute; z-index:3; background:var(--surface); box-shadow:0 14px 30px rgba(13,28,62,.14); }.float-card--pay { right:10px; bottom:28px; display:flex; align-items:center; gap:9px; padding:11px 13px; border-radius:7px; animation:float 5s ease-in-out 1s infinite; }.float-card--pay > span { display:grid; place-items:center; width:25px; height:25px; border-radius:50%; color:#fff; background:#47ad7c; font-size:.76rem; }.float-card small { display:block; color:var(--muted); font-size:.62rem; }.float-card b { display:block; margin-top:2px; font-size:.65rem; }.float-card--people { left:19%; bottom:-9px; padding:13px 16px; border-radius:7px; border-left:3px solid var(--accent); animation:float 6s ease-in-out .4s infinite; }.float-card--people b { display:block; font-size:1.22rem; }.float-card--people small { color:var(--muted); font-size:.61rem; }
.about { display:grid; grid-template-columns:1fr .85fr; gap:100px; padding-block:122px; border-top:1px solid var(--line); }.section-heading h2,.goal h2,.features h2 { margin-top:16px; }.about__content { padding-top:27px; }.about__content p,.goal__copy p { color:var(--muted); line-height:1.8; font-size:.98rem; }.about__content p + p { margin-top:16px; }.about__content .text-link { margin-top:24px; }
.goal { display:grid; grid-template-columns:1fr .88fr; align-items:center; gap:90px; padding-block:52px 130px; }.goal__art { position:relative; }.image-frame { overflow:hidden; border-radius:7px; box-shadow:18px 18px 0 var(--glow); }.image-frame img { width:100%; aspect-ratio:1.15; display:block; object-fit:cover; transition:transform .6s; }.image-frame:hover img { transform:scale(1.04); }.goal__badge { position:absolute; bottom:-23px; right:-25px; display:flex; align-items:center; width:205px; padding:13px; gap:11px; background:var(--surface); box-shadow:0 14px 30px rgba(13,28,62,.14); border-radius:5px; }.goal__badge > span { color:var(--accent); font:600 1.7rem 'Playfair Display',serif; }.goal__badge p { color:var(--muted); font-size:.65rem; line-height:1.35; }.goal__badge b { display:block; color:var(--ink); font-size:.72rem; }.goal__line { width:95px; height:3px; margin-top:28px; background:var(--accent); }
.features { padding:116px 0 122px; background:var(--surface); }.features__head { max-width:610px; margin-bottom:52px; }.features__head p { max-width:48ch; margin-top:18px; color:var(--muted); line-height:1.7; }.feature-grid { padding:0; margin:0; list-style:none; display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }.feature-card { min-height:240px; position:relative; padding:25px; border:1px solid var(--line); border-radius:7px; background:var(--paper); transition:transform .28s,box-shadow .28s,border-color .28s; }.feature-card:nth-child(4),.feature-card:nth-child(5) { grid-column:span 1; }.feature-card:hover { transform:translateY(-7px); border-color:color-mix(in srgb,var(--accent) 45%,var(--line)); box-shadow:0 20px 35px rgba(22,45,100,.1); }.feature-number { position:absolute; right:18px; top:18px; color:color-mix(in srgb,var(--muted) 60%,transparent); font-size:.7rem; font-weight:700; }.feature-card__icon { display:grid; place-items:center; width:42px; height:42px; margin-bottom:27px; color:var(--accent); background:var(--soft); border-radius:5px; }.feature-card__icon svg { width:22px; }.feature-card h3 { font-size:1.02rem; letter-spacing:-.02em; }.feature-card p { margin-top:10px; color:var(--muted); font-size:.86rem; line-height:1.65; }.card-arrow { position:absolute; bottom:20px; right:22px; color:var(--accent); opacity:0; transform:translate(-5px,5px); transition:.22s; }.feature-card:hover .card-arrow { opacity:1; transform:none; }
.cta { margin-top:0; padding:68px 70px; display:flex; justify-content:space-between; align-items:center; gap:32px; color:#fff; background:linear-gradient(115deg,#173472,#2869da); border-radius:0 0 7px 7px; }.cta .section-kicker { color:#b8d1ff; }.cta h2 { margin-top:14px; }.cta h2 em { color:#fff; }.btn--light { background:#fff; color:#173472; white-space:nowrap; }.footer { padding:34px 0; background:var(--surface); }.footer__row { display:flex; align-items:center; justify-content:space-between; gap:20px; color:var(--muted); font-size:.75rem; }.footer__links { display:flex; gap:21px; font-weight:600; }.footer__links a:hover { color:var(--accent); }
.reveal { opacity:0; transform:translateY(24px); transition:opacity .7s ease var(--delay,0ms),transform .7s cubic-bezier(.2,.7,.2,1) var(--delay,0ms); }.reveal.is-visible { opacity:1; transform:none; } @keyframes float { 50% { transform:translateY(-9px); } } @keyframes spin { to { transform:rotate(360deg); } } @media (prefers-reduced-motion:reduce) { *,*::before,*::after { scroll-behavior:auto!important; animation:none!important; transition:none!important; }.reveal { opacity:1; transform:none; } }
@media (max-width:900px) { .header__desktop-action { display:none; }.menu-toggle { width:38px; height:38px; gap:5px; border-radius:6px; }.menu-toggle i { display:block; width:16px; height:1.5px; background:currentColor; }.nav { position:absolute; left:16px; right:16px; top:65px; display:none; padding:18px; border:1px solid var(--line); border-radius:8px; background:var(--surface); box-shadow:0 18px 35px rgba(17,36,78,.12); }.nav--open { display:grid; gap:18px; }.nav__mobile-link,.nav__mobile-cta { display:block; }.nav__mobile-cta { padding:11px; border-radius:6px; text-align:center; color:#fff; background:var(--accent); }.hero { grid-template-columns:1fr; padding-top:70px; }.hero__visual { max-width:600px; width:100%; justify-self:center; }.about,.goal { gap:50px; }.feature-grid { grid-template-columns:repeat(2,1fr); }.cta { margin-inline:28px; width:auto; }.footer__row { flex-wrap:wrap; } }
@media (max-width:600px) { .shell { padding-inline:20px; }.header__row { min-height:66px; }.brand__logo { width:33px; height:33px; }.brand__name { font-size:.9rem; }.hero { min-height:auto; padding-block:55px 80px; }.hero__cta { align-items:flex-start; flex-direction:column; gap:18px; }.hero__visual { min-height:330px; }.hero__image { width:83%; height:75%; }.dashboard-card { width:205px; padding:13px; }.float-card--pay { right:0; }.float-card--people { left:9%; }.orbit--one { width:370px; height:370px; }.orbit--two { width:300px; height:300px; }.about,.goal { grid-template-columns:1fr; padding-block:80px; }.goal { padding-top:0; gap:60px; }.goal__badge { right:0; }.features { padding-block:80px; }.feature-grid { grid-template-columns:1fr; }.feature-card { min-height:210px; }.cta { margin-inline:20px; padding:43px 26px; align-items:flex-start; flex-direction:column; }.footer__row { align-items:flex-start; flex-direction:column; }.footer__links { flex-wrap:wrap; } }
</style>
