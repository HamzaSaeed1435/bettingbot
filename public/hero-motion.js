"use strict";

(function () {
  if (window.AOS) {
    AOS.init({
      duration: 650,
      easing: "ease-out-cubic",
      once: true,
      offset: 60,
      disable: () => (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches),
    });
  }

  const HERO_TARGETS =
    ".brand-logo, .brand-mark, .brand-sub, .status-cluster, .balance-card, .balance-label, .balance-figure, .meta-item";

  function releaseHeroInlineStyles() {
    document.querySelectorAll(HERO_TARGETS).forEach((el) => {
      el.style.opacity = "";
      el.style.transform = "";
    });
  }

  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (window.gsap && !reduced) {
    try {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from(".brand-logo", { opacity: 0, scale: 0.5, rotate: -25, duration: 0.6 })
        .from(".brand-mark", { opacity: 0, x: -16, duration: 0.5 }, "-=0.4")
        .from(".brand-sub", { opacity: 0, y: 6, duration: 0.4 }, "-=0.3")
        .from(".status-cluster", { opacity: 0, y: -8, duration: 0.4 }, "-=0.4")
        .from(".balance-card", { opacity: 0, y: 24, duration: 0.6 }, "-=0.2")
        .from(".balance-label, .balance-figure", { opacity: 0, y: 10, duration: 0.45, stagger: 0.08 }, "-=0.35")
        .from(".meta-item", { opacity: 0, y: 14, duration: 0.4, stagger: 0.08 }, "-=0.3");
    } catch (e) {
      releaseHeroInlineStyles();
    }
    // Safety net: if the animation ticker never advances for any reason (CDN blocked,
    // a backgrounded/non-composited tab, an ad-blocker, etc.), content must not stay
    // invisible forever. This is a no-op once the real animation has already finished.
    setTimeout(releaseHeroInlineStyles, 2500);
  }
})();
