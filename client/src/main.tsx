import { createRoot } from "react-dom/client";
import App from "./App";
import "leaflet/dist/leaflet.css";
import "./index.css";
import { installNavHistory } from "./lib/navHistory";

if (!window.location.hash) {
  window.location.hash = "#/";
}

installNavHistory();

createRoot(document.getElementById("root")!).render(<App />);
