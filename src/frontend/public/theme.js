(() => {
    const key = 'ssot-theme';
    const system = matchMedia('(prefers-color-scheme: dark)');
    let preference;
    try {
        const stored = localStorage.getItem(key);
        if (stored === 'light' || stored === 'dark') preference = stored;
    } catch {}

    const apply = () => {
        const dark = (preference ?? (system.matches ? 'dark' : 'light')) === 'dark';
        document.documentElement.dataset.theme = dark ? 'dark' : 'light';
        const button = document.querySelector('#theme-toggle');
        if (!button) return;
        button.title = dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-pressed', String(dark));
        button.querySelector('span').textContent = dark ? '☀' : '☾';
    };
    apply();
    system.addEventListener('change', () => { if (!preference) apply(); });
    document.addEventListener('DOMContentLoaded', () => {
        apply();
        document.querySelector('#theme-toggle').addEventListener('click', () => {
            preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
            try { localStorage.setItem(key, preference); } catch {}
            apply();
        });
    });
})();
