(function (global) {
    function showNotification(message, type) {
        var el = document.getElementById('toast-notification');
        if (!el) {
            el = document.createElement('div');
            el.id = 'toast-notification';
            el.className = 'toast-notification';
            document.body.appendChild(el);
        }
        var colors = { success: 'var(--toast-ok)', error: 'var(--toast-err)', info: 'var(--toast-info)' };
        el.style.background = colors[type] || colors.info;
        el.textContent = message;
        el.style.display = 'block';
        el.setAttribute('data-show', '1');
        clearTimeout(global._toastTimer);
        global._toastTimer = setTimeout(function () {
            el.removeAttribute('data-show');
            el.style.display = 'none';
        }, 3800);
    }
    global.showNotification = showNotification;
})(window);
