import { createFileRoute } from "@tanstack/react-router";
import { Download, Eye, Search, Shield, ChevronDown, Settings, Wifi, X } from "lucide-react";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "./landing.css";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "chapaq — see what's on your ports" },
      {
        name: "description",
        content:
          "A macOS menu-bar panel that lists every listening port and kills the one you point at. Free, open source.",
      },
      { name: "theme-color", content: "#FFFFFF" },
    ],
  }),
  component: HomePage,
});

// TODO: point at the real uploaded build once chapay-updates.cs19.dev is live.
const RELEASES_URL = "https://github.com/csdev19/port-watcher/releases";
const GITHUB_URL = "https://github.com/csdev19/port-watcher";
const CONTACT_EMAIL = "mailto:cristiansotomayor.dev@gmail.com";

function HomePage() {
  return (
    <div className="lp">
      <Header />
      <Hero />
      <ProductShot />
      <HowItWorks />
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="lp-header">
      <a href="/" className="lp-brand">
        <span className="lp-mark">
          <Eye size={13} strokeWidth={1.75} aria-hidden />
        </span>
        <span className="lp-wordmark">chapaq</span>
      </a>
      <nav className="lp-nav">
        <a href="#how">How it works</a>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="lp-hero">
      <p className="lp-eyebrow lp-mono">
        <span className="lp-eyebrow-dot" aria-hidden />
        For macOS · free · open source
      </p>
      <h1 className="lp-h1">See what&rsquo;s on your ports. Kill the right one.</h1>
      <p className="lp-sub">
        A menu-bar panel that lists every process listening on your Mac — by port, by app, by
        project folder — and stops the one you point at. One click, no terminal.
      </p>
      <div>
        <DownloadButton />
        <p className="lp-build lp-mono">v0.1.0 · 4.2 MB · macOS 13+ · Apple silicon</p>
      </div>
    </section>
  );
}

/** Points at the releases page — no direct asset link exists yet (see the
 * root TODO). Never claims a non-macOS platform: the label and build line
 * stay macOS-only regardless of visitor OS. */
function DownloadButton() {
  return (
    <a className="lp-cta" href={RELEASES_URL}>
      <Download size={16} strokeWidth={1.75} aria-hidden />
      Download for macOS
    </a>
  );
}

function ProductShot() {
  return (
    <div className="lp-shot-wrap">
      <div
        className="lp-shot"
        role="img"
        aria-label="The chapaq panel under the macOS menu bar, listing four dev ports with one selected."
      >
        <div className="lp-shot-menubar">
          <Wifi size={15} strokeWidth={1.75} aria-hidden />
          <span className="lp-shot-tray">
            <Eye size={16} strokeWidth={1.75} aria-hidden />
            <span className="lp-shot-tray-count lp-mono">4</span>
          </span>
          <span className="lp-shot-clock lp-mono">9:41</span>
        </div>
        <div className="lp-panel">
          <div className="lp-panel-search">
            <Search size={14} strokeWidth={1.75} aria-hidden />
            Search port, app or folder
          </div>
          <div className="lp-panel-label lp-mono">4 DEV</div>
          <ShotRow port="3000" label="Next.js dev" folder="~/dev/tapuy/apps/web" uptime="12m" />
          <ShotRow port="5173" label="Vite" folder="~/dev/laqi/panel" uptime="2h" selected />
          <ShotRow port="8787" label="Wrangler (Workers)" folder="~/dev/niway/api" uptime="40m" />
          <ShotRow port="5432" label="PostgreSQL" folder="Homebrew service" uptime="3d" />
          <div className="lp-fold lp-mono">
            <Shield size={12} strokeWidth={1.75} aria-hidden />
            APPS &amp; SYSTEM · 79
            <span className="lp-fold-spacer" />
            <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
          </div>
          <div className="lp-shot-footer lp-mono">
            83 ports · 4 dev · updated 1s ago
            <Settings size={16} strokeWidth={1.75} aria-hidden />
          </div>
        </div>
      </div>
    </div>
  );
}

function ShotRow({
  port,
  label,
  folder,
  uptime,
  selected,
}: {
  port: string;
  label: string;
  folder: string;
  uptime: string;
  selected?: boolean;
}) {
  return (
    <div className={selected ? "lp-row lp-row-selected" : "lp-row"}>
      <span className="lp-row-port lp-mono">{port}</span>
      <span>
        <span className="lp-row-label">{label}</span>
        <br />
        <span className="lp-row-folder">{folder}</span>
      </span>
      {selected ? (
        <X size={14} strokeWidth={1.75} className="lp-row-kill" aria-hidden />
      ) : (
        <span className="lp-row-uptime lp-mono">{uptime}</span>
      )}
    </div>
  );
}

const HOW_IT_WORKS = [
  {
    num: "01",
    title: "Lists, doesn't monitor",
    body: "Every listening port, labelled by what it is and which project it belongs to. Apps and system services fold away so your dev ports are the list.",
  },
  {
    num: "02",
    title: "Kills the right one",
    body: "Checks the process is still the one on that port before it signals. SIGTERM first, SIGKILL only if it has to. Never touches another user's process.",
  },
  {
    num: "03",
    title: "Costs nothing idle",
    body: (
      <>
        Polls only while the panel is open. Closed, it does nothing at all. <kbd>⌥⌘P</kbd> brings it
        back.
      </>
    ),
  },
];

function HowItWorks() {
  return (
    <section id="how" className="lp-how">
      <div className="lp-how-grid">
        {HOW_IT_WORKS.map((col) => (
          <div className="lp-how-col" key={col.num}>
            <span className="lp-how-num lp-mono">{col.num}</span>
            <h3 className="lp-how-title">{col.title}</h3>
            <p className="lp-how-body">{col.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="lp-footer">
      <span>chapaq · by csdev</span>
      <span className="lp-footer-links">
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">
          Source
        </a>
        <a href={RELEASES_URL} target="_blank" rel="noreferrer">
          Releases
        </a>
        <a href={CONTACT_EMAIL}>Contact</a>
      </span>
    </footer>
  );
}
