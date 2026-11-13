"use client";

import dynamic from "next/dynamic";

// GrapesJS touches window and document, so the editor is never rendered on the server.
const Editor = dynamic(() => import("./editor"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm">Loading the editor...</p>,
});

export default Editor;
