// The fonts a funnel page can use. The editor canvas and the published page
// load the same stylesheet (CSP already allows fonts.googleapis.com / gstatic).
export const FONTS = ["Inter", "Poppins", "Noto Sans SC", "Noto Serif SC", "Montserrat"] as const;
export const FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@400;600;700&family=Montserrat:wght@400;500;600;700&display=swap";
