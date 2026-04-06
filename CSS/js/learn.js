(function () {
    var cfg = {};
    var saveDebounceTimer = null;

    function codeStorageKey() {
        return 'code_task_' + cfg.currentTaskId;
    }

    function scheduleSaveCode() {
        clearTimeout(saveDebounceTimer);
        saveDebounceTimer = setTimeout(saveCodeToStorage, 280);
    }

    function saveCodeToStorage() {
        var ta = document.getElementById('codeInput');
        if (ta) localStorage.setItem(codeStorageKey(), ta.value);
    }

    function loadCodeFromStorage() {
        var ta = document.getElementById('codeInput');
        if (!ta) return;
        ta.defaultValue = cfg.starterCode;
        var saved = localStorage.getItem(codeStorageKey());
        ta.value = saved !== null ? saved : cfg.starterCode;
        updateLineNumbers();
    }

    function updateLineNumbers() {
        var ta = document.getElementById('codeInput');
        var ln = document.getElementById('lineNumbers');
        if (!ta || !ln) return;
        var lines = ta.value.split('\n');
        var numbers = '';
        for (var i = 1; i <= lines.length; i++) numbers += i + '\n';
        ln.textContent = numbers;
        ln.style.height = ta.clientHeight + 'px';
    }

    function syncScroll() {
        var ta = document.getElementById('codeInput');
        var ln = document.getElementById('lineNumbers');
        if (ta && ln) ln.scrollTop = ta.scrollTop;
    }

    function applyLevelUi(levelObj) {
        if (!levelObj) return;
        var ring = document.querySelector('[data-level-ring]');
        if (ring) ring.style.setProperty('--level-pct', levelObj.level_pct + '%');
        var lv = document.querySelector('[data-level-value]');
        if (lv) lv.textContent = String(levelObj.level);
        var xpEl = document.querySelector('[data-xp-sub]');
        if (xpEl) {
            xpEl.textContent = levelObj.xp_in_level + ' / ' + levelObj.xp_to_next + ' XP до след. уровня';
        }
    }

    function applySessionPayload(d) {
        if (!d || !d.success) return;
        var xpSide = document.querySelector('[data-total-xp]');
        if (xpSide) xpSide.textContent = String(d.total_xp);
        var doneEl = document.querySelector('[data-completed-count]');
        if (doneEl) doneEl.textContent = d.completed_tasks + ' / ' + d.total_tasks;
        var pp = document.querySelector('.sidebar-left .progress-card__percent');
        var pf = document.querySelector('.sidebar-left .sidebar-main-progress .duo-progress__fill');
        if (pp) pp.textContent = d.module_progress + '%';
        if (pf) pf.style.width = d.module_progress + '%';
        if (d.level) applyLevelUi(d.level);
        var items = document.querySelectorAll('.module-row[data-module-id]');
        for (var i = 0; i < items.length; i++) {
            var mid = parseInt(items[i].getAttribute('data-module-id'), 10);
            if (mid === d.current_module) {
                var sp = items[i].querySelector('.module-progress span');
                var bar = items[i].querySelector('.duo-progress__fill');
                if (sp) sp.textContent = d.module_progress + '%';
                if (bar) bar.style.width = d.module_progress + '%';
            }
        }
    }

    function fetchSession() {
        fetch('/api/session?task_id=' + encodeURIComponent(cfg.currentTaskId))
            .then(function (r) { return r.json(); })
            .then(applySessionPayload)
            .catch(function () {});
    }

    function checkCode() {
        var ta = document.getElementById('codeInput');
        var outputEl = document.getElementById('output');
        if (!ta || !outputEl) return;

        fetch('/check_code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: ta.value, task_id: cfg.currentTaskId }),
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.error && !data.hasOwnProperty('success')) {
                    showNotification(data.error || 'Ошибка', 'error');
                    return;
                }
                if (data.success) {
                    if (data.already_completed) {
                        showNotification('Задание уже выполнено', 'info');
                        outputEl.style.color = 'var(--warning)';
                        outputEl.innerHTML = 'Задание уже было решено ранее.';
                    } else {
                        outputEl.style.color = 'var(--success)';
                        outputEl.innerHTML =
                            '<strong>Верно</strong><br>Вывод: ' +
                            (data.output || '(пусто)') +
                            '<br>+' +
                            data.xp_gained +
                            ' XP · всего ' +
                            data.total_xp;
                        showNotification('Отлично! +' + data.xp_gained + ' XP', 'success');
                        saveCodeToStorage();
                        fetchSession();
                        if (data.module_completed) {
                            showNotification('Модуль завершён', 'success');
                            setTimeout(function () {
                                if (confirm('Перейти к следующему заданию?')) nextTask();
                            }, 600);
                        } else {
                            var btn = document.getElementById('checkCodeBtn');
                            if (btn && btn.textContent.indexOf('Проверить') !== -1) {
                                btn.disabled = true;
                                btn.style.opacity = '0.65';
                                btn.textContent = 'Готово';
                                setTimeout(function () {
                                    btn.disabled = false;
                                    btn.style.opacity = '1';
                                    btn.textContent = 'Проверить решение';
                                }, 1600);
                            }
                        }
                    }
                } else {
                    outputEl.style.color = 'var(--danger)';
                    var exp = data.expected != null ? data.expected : '';
                    var msg =
                        'Неверно<br>Вывод: ' +
                        (data.output || '(пусто)') +
                        '<br>Ожидалось: ' +
                        exp;
                    if (data.error_detail || data.error) {
                        msg += '<br><span class="err-python">' + (data.error_detail || data.error) + '</span>';
                    }
                    outputEl.innerHTML = msg;
                    showNotification('Попробуйте ещё раз', 'error');
                    saveCodeToStorage();
                }
            })
            .catch(function () {
                showNotification('Сеть или сервер недоступны', 'error');
            });
    }

    function nextTask() {
        saveCodeToStorage();
        fetch('/next_task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                module_num: cfg.currentModule,
                task_index: cfg.currentTaskIndex,
            }),
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.completed) {
                    showNotification('Все задания пройдены!', 'success');
                    setTimeout(function () { location.reload(); }, 1200);
                } else if (data.success) location.reload();
            });
    }

    function previousTask() {
        if (cfg.currentTaskIndex <= 0) return;
        saveCodeToStorage();
        fetch('/next_task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                module_num: cfg.currentModule,
                task_index: cfg.currentTaskIndex - 2,
            }),
        }).then(function () {
            location.reload();
        });
    }

    function loadModule(moduleId) {
        saveCodeToStorage();
        window.location.href = '/load_module/' + moduleId;
    }

    function resetProgress() {
        if (!confirm('Сбросить весь прогресс?')) return;
        localStorage.clear();
        fetch('/reset_progress', { method: 'POST' }).then(function () {
            location.reload();
        });
    }

    function clearCode() {
        clearTimeout(saveDebounceTimer);
        var ta = document.getElementById('codeInput');
        var outputEl = document.getElementById('output');
        if (!ta || !outputEl) return;
        localStorage.removeItem(codeStorageKey());
        ta.value = cfg.starterCode;
        ta.defaultValue = cfg.starterCode;
        updateLineNumbers();
        syncScroll();
        outputEl.innerHTML = 'Готов к выполнению';
        outputEl.style.color = 'var(--success)';
        showNotification('Код сброшен к шаблону', 'info');
    }

    function onTabKey(e) {
        if (e.key !== 'Tab' || e.target.id !== 'codeInput') return;
        e.preventDefault();
        var ta = e.target;
        var start = ta.selectionStart;
        var end = ta.selectionEnd;
        var sp = '    ';
        ta.value = ta.value.substring(0, start) + sp + ta.value.substring(end);
        ta.selectionStart = ta.selectionEnd = start + sp.length;
        updateLineNumbers();
        scheduleSaveCode();
    }

    function init() {
        var el = document.getElementById('learn-config');
        if (!el) return;
        try {
            cfg = JSON.parse(el.textContent);
        } catch (e) {
            return;
        }

        window.nextTask = nextTask;
        window.previousTask = previousTask;
        window.loadModule = loadModule;
        window.resetProgress = resetProgress;

        var ta = document.getElementById('codeInput');
        if (!ta) return;

        ta.style.whiteSpace = 'pre';
        ta.style.overflowX = 'auto';
        loadCodeFromStorage();

        ta.addEventListener('input', function () {
            updateLineNumbers();
            scheduleSaveCode();
        });
        ta.addEventListener('keydown', onTabKey);
        ta.addEventListener('scroll', syncScroll);
        window.addEventListener('resize', updateLineNumbers);
        window.addEventListener('beforeunload', function () {
            clearTimeout(saveDebounceTimer);
            saveCodeToStorage();
        });

        setTimeout(updateLineNumbers, 80);

        var hintBtn = document.getElementById('hintBtn');
        if (hintBtn) {
            hintBtn.addEventListener('click', function () {
                showNotification('Подсказка: ' + cfg.hint, 'info');
            });
        }
        var checkBtn = document.getElementById('checkCodeBtn');
        if (checkBtn) checkBtn.addEventListener('click', function (e) { e.preventDefault(); checkCode(); });
        var clearBtn = document.getElementById('clearCodeBtn');
        if (clearBtn) clearBtn.addEventListener('click', function (e) { e.preventDefault(); clearCode(); });

        if (cfg.taskDone) {
            var out = document.getElementById('output');
            if (out) {
                out.style.color = 'var(--success)';
                out.innerHTML = 'Задание выполнено · +' + cfg.taskXpEarned + ' XP';
            }
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})();
