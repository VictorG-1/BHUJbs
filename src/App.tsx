import { useState } from "react";
import { AdminPage } from "./pages/AdminPage";
import { RegisterPage } from "./pages/RegisterPage";
import { isSupabaseConfigured } from "./lib/supabase";
import "./styles/app.css";

type Page = "register" | "admin";
type Language = "en" | "gu";

export default function App() {
  const [page, setPage] = useState<Page>("register");
  const [language, setLanguage] = useState<Language>("en");

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={(event) => event.preventDefault()}>
          <div className="brand-mark" aria-hidden="true">
            <img src="/logo-1.png" alt="" />
            <img src="/logo-2.png" alt="" />
          </div>
          <div className="brand-copy">
            <strong>Shrimad Samuha Bhagwat Saptah</strong>
            <span>Shree Kutchi Maheshwari Samaj Bhuj</span>
          </div>
        </a>
        <nav>
          <button className={page === "register" ? "active" : ""} onClick={() => setPage("register")}>
            {language === "gu" ? "નોંધણી" : "Register"}
          </button>
          <button className={page === "admin" ? "active" : ""} onClick={() => setPage("admin")}>
            {language === "gu" ? "એડમિન" : "Admin"}
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
        {page === "register" ? <RegisterPage language={language} /> : null}
        {page === "admin" ? <AdminPage /> : null}
      </main>
    </div>
  );
}
