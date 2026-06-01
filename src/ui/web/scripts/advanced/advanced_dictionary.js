// Dictionary Tab Logic

function loadDictionaryTab() {
    if (!api) return;

    // Set up Add button
    const addBtn = document.getElementById('addDictBtn');
    const newAddBtn = addBtn.cloneNode(true);
    addBtn.parentNode.replaceChild(newAddBtn, addBtn);
    
    newAddBtn.addEventListener('click', () => {
        const origInput = document.getElementById('newDictOriginal');
        const spellInput = document.getElementById('newDictSpelling');
        const caseCheck = document.getElementById('newDictCaseSensitive');
        
        const original = origInput.value.trim();
        const spelling = spellInput.value.trim();
        const isCaseSensitive = caseCheck.checked;
        
        if (!original || !spelling) {
            showToast('Please enter both original text and spelling.', 'error');
            return;
        }
        
        api.addDictionaryEntry(original, spelling, isCaseSensitive, (success) => {
            if (success) {
                origInput.value = '';
                spellInput.value = '';
                caseCheck.checked = false;
                refreshDictionaryList();
            } else {
                showToast('Failed to add entry. Dictionary might be full (max 500).', 'error');
            }
        });
    });

    refreshDictionaryList();
}

function refreshDictionaryList() {
    api.getDictionary(function(dictJson) {
        let entries = [];
        try {
            entries = JSON.parse(dictJson);
        } catch (e) {
            console.error('Failed to parse dictionary JSON');
            return;
        }

        const container = document.getElementById('dictionaryList');
        container.innerHTML = '';

        if (entries.length === 0) {
            container.innerHTML = '<div class="empty-state">No dictionary entries yet.</div>';
            return;
        }

        entries.forEach((entry, index) => {
            const item = document.createElement('div');
            item.className = 'list-item dict-item';
            item.style.flexDirection = 'column';
            item.style.alignItems = 'stretch';
            item.style.gap = '8px';

            // Row 1: Inputs
            const row1 = document.createElement('div');
            row1.style.display = 'flex';
            row1.style.gap = '10px';
            
            const origInput = document.createElement('input');
            origInput.type = 'text';
            origInput.value = entry.original;
            origInput.maxLength = 30;
            origInput.style.flex = '1';
            
            const spellInput = document.createElement('input');
            spellInput.type = 'text';
            spellInput.value = entry.spelling;
            spellInput.maxLength = 30;
            spellInput.style.flex = '1';
            
            row1.appendChild(origInput);
            row1.appendChild(spellInput);

            // Row 2: Actions
            const row2 = document.createElement('div');
            row2.style.display = 'flex';
            row2.style.justifyContent = 'space-between';
            row2.style.alignItems = 'center';

            const caseLabel = document.createElement('label');
            caseLabel.className = 'dict-checkbox-label';
            const caseCheck = document.createElement('input');
            caseCheck.type = 'checkbox';
            caseCheck.checked = entry.case_sensitive;
            caseLabel.appendChild(caseCheck);
            caseLabel.appendChild(document.createTextNode(' Case sensitive'));

            const buttonsDiv = document.createElement('div');
            buttonsDiv.style.display = 'flex';
            buttonsDiv.style.gap = '10px';

            const updateBtn = document.createElement('button');
            updateBtn.className = 'btn-primary';
            updateBtn.textContent = 'Save';
            updateBtn.addEventListener('click', () => {
                api.updateDictionaryEntry(
                    index, 
                    origInput.value.trim(), 
                    spellInput.value.trim(), 
                    caseCheck.checked, 
                    (success) => {
                        if (success) {
                            showToast('Entry updated successfully', 'success');
                            refreshDictionaryList();
                        } else {
                            showToast('Failed to update entry', 'error');
                        }
                    }
                );
            });

            const testBtn = document.createElement('button');
            testBtn.className = 'btn-secondary';
            testBtn.textContent = 'Test';
            testBtn.addEventListener('click', () => {
                const sp = spellInput.value.trim();
                if (sp) {
                    api.testDictionarySpelling(sp);
                }
            });

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-secondary';
            delBtn.style.color = '#ef4444';
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', () => {
                api.deleteDictionaryEntry(index, (success) => {
                    if (success) {
                        refreshDictionaryList();
                    }
                });
            });

            buttonsDiv.appendChild(updateBtn);
            buttonsDiv.appendChild(testBtn);
            buttonsDiv.appendChild(delBtn);

            row2.appendChild(caseLabel);
            row2.appendChild(buttonsDiv);

            item.appendChild(row1);
            item.appendChild(row2);
            container.appendChild(item);
        });
    });
}
