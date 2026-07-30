(function () {
  const moduleState = {
    initialized: false,
    initializedAt: "",
    renderCount: 0
  };

  async function initCRM(options = {}) {
    const root = options.root || document.getElementById("crm");
    if (!root) throw new Error("CRM module root was not found.");

    root.dataset.module = "crm";
    root.dataset.moduleLoaded = "true";
    moduleState.initialized = true;
    moduleState.initializedAt ||= new Date().toISOString();
    moduleState.renderCount += 1;

    const preserveScroll = options.preserveScroll !== false;
    const resetLimit = Boolean(options.resetLimit);
    const legacyRenderer = options.legacyEnsureCrmLeadsRendered || window.ensureCrmLeadsRendered;
    const directRenderer = options.renderLeads || window.renderLeads;

    if (typeof legacyRenderer === "function") {
      legacyRenderer({ preserveScroll, resetLimit });
    } else if (typeof directRenderer === "function") {
      directRenderer();
    } else {
      throw new Error("CRM renderer is not available.");
    }

    return { ...moduleState };
  }

  window.initCRM = initCRM;
})();
