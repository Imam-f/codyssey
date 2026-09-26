import { createRoot } from "react-dom/client";
import App from "./App";
import DeclarationPopup from "./DeclarationPopup";
import "./styles.css";
import "./styles2.css";
import "./calls.css";

createRoot(document.getElementById("root")).render(
  new URLSearchParams(window.location.search).has("popout") ? <DeclarationPopup /> : <App />,
);
