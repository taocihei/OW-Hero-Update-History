import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installExternalLinkHandler } from "./externalLinks";
import "./styles.css";

installExternalLinkHandler();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
