import io
import os
import secrets
import sys
import traceback

from flask import Flask, jsonify, redirect, render_template, request, session, url_for

from course_data import (
    ACHIEVEMENTS,
    LESSONS,
    TASK_BY_ID,
    TOTAL_TASKS_COUNT,
    XP_PER_LEVEL,
)

app = Flask(__name__, static_folder='CSS', template_folder='HTML')
app.secret_key = os.environ.get('FLASK_SECRET_KEY', secrets.token_hex(32))

SAFE_BUILTINS = {
    'print': print,
    'len': len,
    'range': range,
    'str': str,
    'int': int,
    'float': float,
    'bool': bool,
    'abs': abs,
    'min': min,
    'max': max,
    'sum': sum,
    'round': round,
    'enumerate': enumerate,
    'zip': zip,
    'sorted': sorted,
    'list': list,
    'tuple': tuple,
    'dict': dict,
    'set': set,
    'reversed': reversed,
}

user_progress = {}


class UserProgress:
    def __init__(self):
        self.completed_tasks = []
        self.total_xp = 0
        self.current_module = 1
        self.current_task_index = 0

    def complete_task(self, task_id, xp):
        if task_id not in self.completed_tasks:
            self.completed_tasks.append(task_id)
            self.total_xp += xp
            return True
        return False

    def get_module_progress(self, module_id):
        if module_id not in LESSONS:
            return 0
        tasks = LESSONS[module_id]['tasks']
        if not tasks:
            return 0
        completed = sum(1 for task in tasks if task['id'] in self.completed_tasks)
        return int((completed / len(tasks)) * 100)

    def is_module_completed(self, module_id):
        return self.get_module_progress(module_id) == 100

    def get_next_module(self):
        for i in range(1, 6):
            if not self.is_module_completed(i):
                return i
        return None


def get_user_progress():
    user_id = session.get('user_id')
    if not user_id:
        user_id = secrets.token_hex(8)
        session['user_id'] = user_id
        user_progress[user_id] = UserProgress()
    return user_progress.get(user_id, UserProgress())


def build_modules_stats(progress):
    return [
        {
            'id': i,
            'title': LESSONS[i]['title'],
            'icon': LESSONS[i]['icon'],
            'progress': progress.get_module_progress(i),
            'is_locked': i > 1 and not progress.is_module_completed(i - 1),
        }
        for i in range(1, 6)
        if i in LESSONS
    ]


def level_meta(total_xp):
    level = total_xp // XP_PER_LEVEL + 1
    in_level = total_xp % XP_PER_LEVEL
    pct = int(in_level * 100 / XP_PER_LEVEL) if XP_PER_LEVEL else 0
    return {
        'level': level,
        'xp_in_level': in_level,
        'xp_to_next': XP_PER_LEVEL,
        'level_pct': pct,
        'total_xp': total_xp,
    }


def next_task_preview(progress):
    mid = progress.current_module
    idx = progress.current_task_index
    if mid not in LESSONS:
        return None
    tasks = LESSONS[mid]['tasks']
    if idx >= len(tasks):
        return None
    t = tasks[idx]
    mod = LESSONS[mid]
    return {
        'module_title': mod['title'],
        'module_icon': mod['icon'],
        'text': t['text'],
        'task_id': t['id'],
    }


def achievement_list(completed_n, total_n):
    frac = completed_n / total_n if total_n else 0.0
    out = []
    for a in ACHIEVEMENTS:
        unlocked = False
        if 'min_completed' in a:
            unlocked = completed_n >= a['min_completed']
        elif 'min_fraction' in a:
            unlocked = frac >= a['min_fraction'] - 1e-9
        out.append({
            'id': a['id'],
            'icon': a['icon'],
            'title': a['title'],
            'description': a['description'],
            'unlocked': unlocked,
        })
    return out


def run_user_code(code):
    buf = io.StringIO()
    old_out = sys.stdout
    sys.stdout = buf
    err_line = None
    try:
        g = {'__builtins__': SAFE_BUILTINS}
        exec(compile(code, '<user>', 'exec'), g, g)
        output = buf.getvalue().strip()
        return output, None, err_line
    except Exception as e:
        output = ''
        err_line = ''.join(traceback.format_exception_only(type(e), e)).strip()
        return output, str(e), err_line
    finally:
        sys.stdout = old_out


@app.route('/')
def home():
    progress = get_user_progress()
    completed_tasks = len(progress.completed_tasks)
    has_progress = completed_tasks > 0 or progress.total_xp > 0
    lm = level_meta(progress.total_xp)
    overall_pct = int(completed_tasks * 100 / TOTAL_TASKS_COUNT) if TOTAL_TASKS_COUNT else 0
    return render_template(
        'index.html',
        user=progress,
        modules_stats=build_modules_stats(progress),
        total_tasks=TOTAL_TASKS_COUNT,
        completed_tasks=completed_tasks,
        has_progress=has_progress,
        level_info=lm,
        next_task=next_task_preview(progress),
        achievements=achievement_list(completed_tasks, TOTAL_TASKS_COUNT),
        overall_progress_pct=overall_pct,
    )


@app.route('/learn')
def learn():
    progress = get_user_progress()
    current_module = progress.current_module
    current_task_index = progress.current_task_index

    if current_module in LESSONS:
        tasks = LESSONS[current_module]['tasks']
        if current_task_index >= len(tasks):
            if progress.is_module_completed(current_module):
                next_m = progress.get_next_module()
                if next_m:
                    progress.current_module = next_m
                    progress.current_task_index = 0
                    current_module = next_m
                    current_task_index = 0
                else:
                    return render_template('module_complete.html', all_completed=True)

    if current_module not in LESSONS:
        current_module = 1
        progress.current_module = 1
        current_task_index = 0

    module = LESSONS[current_module]
    tasks = module['tasks']
    if current_task_index >= len(tasks):
        current_task_index = 0

    current_task = tasks[current_task_index]
    task_done = current_task['id'] in progress.completed_tasks
    lm = level_meta(progress.total_xp)

    return render_template(
        'learn.html',
        user=progress,
        current_module=module,
        current_module_num=current_module,
        current_task=current_task,
        current_task_index=current_task_index,
        modules_stats=build_modules_stats(progress),
        total_tasks=TOTAL_TASKS_COUNT,
        completed_tasks=len(progress.completed_tasks),
        task_already_done=task_done,
        level_info=lm,
    )


@app.route('/check_code', methods=['POST'])
def check_code():
    progress = get_user_progress()
    data = request.get_json() or {}
    code = data.get('code', '')
    task_id = data.get('task_id')

    task = TASK_BY_ID.get(task_id)
    if not task:
        return jsonify({'error': 'Задание не найдено'}), 400

    expected = task['expected']

    if task_id in progress.completed_tasks:
        return jsonify({
            'success': True,
            'already_completed': True,
            'message': 'Задание уже выполнено!',
            'output': '',
            'xp_gained': 0,
            'total_xp': progress.total_xp,
        })

    output, error_short, error_detail = run_user_code(code)

    is_correct = False
    if error_short is None:
        output_lines = [line.strip() for line in output.split('\n') if line.strip()]
        expected_lines = [line.strip() for line in expected.split('\n') if line.strip()]
        is_correct = output_lines == expected_lines

    if is_correct:
        progress.complete_task(task_id, task['xp'])
        current_module = progress.current_module
        module_completed = progress.is_module_completed(current_module)
        return jsonify({
            'success': True,
            'output': output,
            'xp_gained': task['xp'],
            'total_xp': progress.total_xp,
            'module_completed': module_completed,
            'next_module': current_module + 1 if module_completed and current_module + 1 in LESSONS else None,
            'level': level_meta(progress.total_xp),
        })

    return jsonify({
        'success': False,
        'output': output if output else '(пусто)',
        'expected': expected,
        'error': error_short,
        'error_detail': error_detail,
    })


@app.route('/next_task', methods=['POST'])
def next_task():
    progress = get_user_progress()
    data = request.get_json() or {}
    module_num = data.get('module_num')
    task_index = data.get('task_index')

    if module_num in LESSONS:
        tasks = LESSONS[module_num]['tasks']
        if task_index + 1 < len(tasks):
            progress.current_module = module_num
            progress.current_task_index = task_index + 1
        else:
            next_m = progress.get_next_module()
            if next_m:
                progress.current_module = next_m
                progress.current_task_index = 0
            else:
                return jsonify({'completed': True})

    return jsonify({
        'success': True,
        'module': progress.current_module,
        'task_index': progress.current_task_index,
    })


@app.route('/reset_progress', methods=['POST'])
def reset_progress():
    uid = session.get('user_id')
    if uid:
        user_progress[uid] = UserProgress()
    return jsonify({'success': True})


@app.route('/load_module/<int:module_id>')
def load_module(module_id):
    progress = get_user_progress()
    if module_id > 1 and not progress.is_module_completed(module_id - 1):
        return jsonify({'error': 'Модуль заблокирован'}), 403
    if module_id in LESSONS:
        progress.current_module = module_id
        progress.current_task_index = 0
    return redirect(url_for('learn'))


@app.route('/api/session')
def api_session():
    progress = get_user_progress()
    task_id = request.args.get('task_id', type=int)
    payload = {
        'success': True,
        'total_xp': progress.total_xp,
        'completed_tasks': len(progress.completed_tasks),
        'total_tasks': TOTAL_TASKS_COUNT,
        'module_progress': progress.get_module_progress(progress.current_module),
        'current_module': progress.current_module,
        'level': level_meta(progress.total_xp),
    }
    if task_id is not None:
        payload['task_completed'] = task_id in progress.completed_tasks
    return jsonify(payload)


if __name__ == '__main__':
    app.run(host="0.0.0.0", port=10000)
