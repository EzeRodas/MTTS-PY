// Handles titlebar/window dragging
const dragArea = document.getElementById('dragArea');
let isDragging = false;
let dragStartX = 0, dragStartY = 0;

dragArea.addEventListener('mousedown', (e) => {
    if (dragArea.classList.contains('disabled')) return;
    isDragging = true;
    dragStartX = e.screenX;
    dragStartY = e.screenY;
    if(api) api.startDrag(dragStartX, dragStartY);
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging || !api) return;
    api.doDrag(e.screenX, e.screenY);
});

document.addEventListener('mouseup', () => { isDragging = false; });
