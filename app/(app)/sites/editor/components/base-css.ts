// Default look of the components. Added to a page's CSS when its editor
// opens (once), so the published page carries it. Mobile-first stacking comes
// from flex-wrap + min-width, not breakpoints.
export const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
body{margin:0;font-family:Inter,system-ui,sans-serif;color:#0a0a0a;line-height:1.55}
.lead-section{padding:64px 24px}
.lead-row{display:flex;flex-wrap:wrap;gap:24px;max-width:1120px;margin:0 auto}
.lead-column{flex:1 1 0;min-width:240px;min-height:48px}
.lead-heading{font-size:44px;line-height:1.12;margin:0 0 16px;font-weight:700}
.lead-subheading{font-size:24px;line-height:1.3;margin:0 0 16px;font-weight:500;color:#3d3d3d}
.lead-paragraph{margin:0 0 16px}
.lead-rich-text{margin:0 0 16px}
.lead-bullet-list{margin:0 0 16px;padding-left:22px}
.lead-image{max-width:100%;height:auto;display:block}
.lead-divider{border:0;border-top:1px solid #e5e5ea;margin:24px 0}
.lead-button{display:inline-block;padding:14px 28px;background:#3d3d3d;color:#ffffff;border-radius:10px;text-decoration:none;font-weight:600}
.lead-whatsapp-button{background:#0a0a0a}
.lead-counter{font-size:56px;font-weight:700;line-height:1.1}
.lead-social-icons{display:flex;flex-wrap:wrap;gap:16px}
.lead-social{color:#3d3d3d;text-decoration:underline}
.lead-logo-showcase{display:flex;flex-wrap:wrap;gap:24px;align-items:center;justify-content:center}
.lead-logo{max-height:48px;width:auto}
.lead-faq-item{border-bottom:1px solid #e5e5ea;padding:16px 0}
.lead-faq-q{margin:0;font-size:18px;font-weight:600}
.lead-faq-a{margin:8px 0 0}
.lead-nav-menu{display:flex;flex-wrap:wrap;gap:20px;align-items:center}
.lead-nav-link{color:#0a0a0a;text-decoration:none;font-weight:500}
.lead-image-slider .lead-slide{width:100%}
@media (max-width:575px){.lead-section{padding:40px 16px}.lead-heading{font-size:30px}.lead-subheading{font-size:20px}.lead-counter{font-size:40px}}
`;
