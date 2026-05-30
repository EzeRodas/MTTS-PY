// Synthesis History List Configuration Tab
function loadHistoryTab() {
    if (!api) return;
    refreshHistoryList();

    const clearBtn = document.getElementById('clearHistoryBtn');
    const newClearBtn = clearBtn.cloneNode(true);
    clearBtn.parentNode.replaceChild(newClearBtn, clearBtn);
    newClearBtn.addEventListener('click', () => {
        showConfirm(
            'Clear History',
            'Are you sure you want to delete all synthesis history?',
            () => {
                api.clearHistory();
                setTimeout(refreshHistoryList, 100);
            }
        );
    });
}

function refreshHistoryList() {
    api.getHistory(function(historyJson) {
        const history = JSON.parse(historyJson);
        const container = document.getElementById('historyList');
        container.innerHTML = '';

        if (history.length === 0) {
            container.innerHTML = '<div class="empty-state">No speech history found.</div>';
            return;
        }

        history.forEach((text, index) => {
            const item = document.createElement('div');
            item.className = 'list-item';

            const label = document.createElement('div');
            label.className = 'list-item-text';
            label.textContent = text;
            label.title = text;

            const actions = document.createElement('div');
            actions.className = 'list-item-actions';

            const playBtn = document.createElement('button');
            playBtn.className = 'btn-secondary';
            playBtn.textContent = 'Play';
            playBtn.addEventListener('click', () => api.playHistory(index));

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-secondary';
            delBtn.style.color = '#ef4444';
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', () => {
                api.deleteHistory(index);
                setTimeout(refreshHistoryList, 100);
            });

            actions.appendChild(playBtn);
            actions.appendChild(delBtn);
            item.appendChild(label);
            item.appendChild(actions);
            container.appendChild(item);
        });
    });
}
