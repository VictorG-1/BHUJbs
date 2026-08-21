import { useEffect, useState } from "react";
import { AdminPage } from "./pages/AdminPage";
import { RegisterPage } from "./pages/RegisterPage";
import { BroadcastPage, ItineraryPage, LandingPage, SiteFooter, SponsorsPage, TermsPage } from "./pages/PublicPages";
import { isSupabaseConfigured } from "./lib/supabase";
import "./styles/app.css";

type Page = "landing" | "register" | "admin" | "itinerary" | "broadcast" | "sponsors" | "terms";
type Language = "en" | "gu";

export default function App() {
  const [page, setPage] = useState<Page>(() => (window.location.pathname === "/admin" ? "admin" : "landing"));
  const [language, setLanguage] = useState<Language>("en");

  useEffect(() => {
    const handlePopState = () => setPage(window.location.pathname === "/admin" ? "admin" : "landing");
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(nextPage: Page) {
    const path = nextPage === "admin" ? "/admin" : "/";
    window.history.pushState({}, "", path);
    setPage(nextPage);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand brand-button" onClick={() => navigate("landing")}>
          <div className="brand-mark" aria-hidden="true">
            <img src="/logo-1.png" alt="" />
            <img src="/logo-2.png" alt="" />
          </div>
          <div className="brand-copy">
            <strong>Shrimad Samuha Bhagwat Saptah</strong>
            <span>Shree Kutchi Maheshwari Samaj Bhuj</span>
          </div>
        </button>
        <nav>
          <button className={page === "register" ? "active" : ""} onClick={() => navigate("register")}>
            {language === "gu" ? "નોંધણી" : "Register"}
          </button>
          <button className={page === "itinerary" ? "active" : ""} onClick={() => navigate("itinerary")}>
            {language === "gu" ? "કાર્યક્રમ" : "Itinerary"}
          </button>
          <button className={page === "broadcast" ? "active" : ""} onClick={() => navigate("broadcast")}>
            {language === "gu" ? "લાઇવ" : "Live"}
          </button>
          <button className={page === "sponsors" ? "active" : ""} onClick={() => navigate("sponsors")}>
            {language === "gu" ? "પ્રાયોજકો" : "Sponsors"}
          </button>
          <button className={page === "terms" ? "active" : ""} onClick={() => navigate("terms")}>
            {language === "gu" ? "શરતો" : "Terms"}
          </button>
          <button
            className={language === "gu" ? "active" : ""}
            onClick={() => setLanguage((current) => (current === "en" ? "gu" : "en"))}
          >
            {language === "gu" ? "English" : "ગુજરાતી"}
          </button>
        </nav>
      </header>

      {!isSupabaseConfigured ? (
        <div className="config-banner">
          Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to `.env` before connecting live data.
        </div>
      ) : null}

      <main>
        {page === "landing" ? <LandingPage language={language} onNavigate={navigate} /> : null}
        {page === "register" ? <RegisterPage language={language} /> : null}
        {page === "admin" ? <AdminPage language={language} /> : null}
        {page === "itinerary" ? <ItineraryPage language={language} onNavigate={navigate} /> : null}
        {page === "broadcast" ? <BroadcastPage language={language} onNavigate={navigate} /> : null}
        {page === "sponsors" ? <SponsorsPage language={language} onNavigate={navigate} /> : null}
        {page === "terms" ? <TermsPage language={language} onNavigate={navigate} /> : null}
      </main>
      <SiteFooter language={language} onNavigate={navigate} />
    </div>
  );
}
