document.addEventListener('DOMContentLoaded', () => {
    const docData = document.getElementById('doc-data');
    const pdfUrl = docData.dataset.url;
    const docId = docData.dataset.id;
    const csrfToken = docData.dataset.csrf;

    let pdfDoc = null;
    let pageNum = 1;
    let pageRendering = false;
    let pageNumPending = null;
    const scale = 1.5;
    const canvas = document.getElementById('pdf-render');
    const ctx = canvas.getContext('2d');

    // UI Elements
    const sigOverlay = document.getElementById('signature-overlay');
    const sigImg = document.getElementById('signature-img');
    const applyBtn = document.getElementById('apply-btn');
    
    // PDF rendering
    function renderPage(num) {
        pageRendering = true;
        pdfDoc.getPage(num).then(function(page) {
            const viewport = page.getViewport({scale: scale});
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            const renderContext = {
                canvasContext: ctx,
                viewport: viewport
            };
            const renderTask = page.render(renderContext);

            renderTask.promise.then(function() {
                pageRendering = false;
                if (pageNumPending !== null) {
                    renderPage(pageNumPending);
                    pageNumPending = null;
                }
            });
        });

        document.getElementById('page-num').textContent = num;
        document.getElementById('prev-page').disabled = num <= 1;
        document.getElementById('next-page').disabled = num >= pdfDoc.numPages;
    }

    function queueRenderPage(num) {
        if (pageRendering) {
            pageNumPending = num;
        } else {
            renderPage(num);
        }
    }

    document.getElementById('prev-page').addEventListener('click', () => {
        if (pageNum <= 1) return;
        pageNum--;
        queueRenderPage(pageNum);
    });

    document.getElementById('next-page').addEventListener('click', () => {
        if (pageNum >= pdfDoc.numPages) return;
        pageNum++;
        queueRenderPage(pageNum);
    });

    // Load PDF
    pdfjsLib.getDocument(pdfUrl).promise.then(function(pdfDoc_) {
        pdfDoc = pdfDoc_;
        document.getElementById('page-count').textContent = pdfDoc.numPages;
        renderPage(pageNum);
    });

    // Tabs logic
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
        });
    });

    // Draw Signature Logic
    const drawCanvas = document.getElementById('draw-canvas');
    const drawCtx = drawCanvas.getContext('2d');
    let isDrawing = false;

    // Set white background for drawing canvas so it's not transparent
    drawCtx.fillStyle = 'transparent';
    drawCtx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
    drawCtx.lineWidth = 3;
    drawCtx.lineCap = 'round';
    drawCtx.strokeStyle = '#000';

    function startPosition(e) {
        isDrawing = true;
        draw(e);
    }
    function endPosition() {
        isDrawing = false;
        drawCtx.beginPath();
    }
    function draw(e) {
        if (!isDrawing) return;
        
        const rect = drawCanvas.getBoundingClientRect();
        const x = e.clientX ? e.clientX - rect.left : e.touches[0].clientX - rect.left;
        const y = e.clientY ? e.clientY - rect.top : e.touches[0].clientY - rect.top;

        drawCtx.lineTo(x, y);
        drawCtx.stroke();
        drawCtx.beginPath();
        drawCtx.moveTo(x, y);
    }

    drawCanvas.addEventListener('mousedown', startPosition);
    drawCanvas.addEventListener('mouseup', endPosition);
    drawCanvas.addEventListener('mousemove', draw);
    
    drawCanvas.addEventListener('touchstart', startPosition, {passive: true});
    drawCanvas.addEventListener('touchend', endPosition);
    drawCanvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        draw(e);
    }, {passive: false});

    document.getElementById('clear-canvas').addEventListener('click', () => {
        drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    });

    // Upload PNG Logic
    let currentSignatureFile = null;

    document.getElementById('sig-upload').addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            currentSignatureFile = e.target.files[0];
            const reader = new FileReader();
            reader.onload = function(e) {
                sigImg.src = e.target.result;
                sigOverlay.style.display = 'block';
                applyBtn.disabled = false;
                resetSignaturePosition();
            }
            reader.readAsDataURL(e.target.files[0]);
        }
    });

    // Use Drawn Signature
    document.getElementById('use-drawn-sig').addEventListener('click', () => {
        drawCanvas.toBlob((blob) => {
            currentSignatureFile = new File([blob], "drawn_signature.png", { type: "image/png" });
            sigImg.src = URL.createObjectURL(blob);
            sigOverlay.style.display = 'block';
            applyBtn.disabled = false;
            resetSignaturePosition();
        }, 'image/png');
    });

    function resetSignaturePosition() {
        sigOverlay.style.transform = 'translate(-50%, -50%)';
        sigOverlay.setAttribute('data-x', 0);
        sigOverlay.setAttribute('data-y', 0);
        sigOverlay.style.width = '150px';
        sigOverlay.style.height = 'auto';
    }

    // Interact.js for drag and resize
    interact('.draggable-signature')
        .draggable({
            listeners: {
                start(event) {
                    console.log(event.type, event.target);
                },
                move(event) {
                    const target = event.target;
                    const x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx;
                    const y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;

                    target.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
                    target.setAttribute('data-x', x);
                    target.setAttribute('data-y', y);
                },
            }
        })
        .resizable({
            edges: { left: false, right: '.resize-handle', bottom: '.resize-handle', top: false },
            listeners: {
                move(event) {
                    let { x, y } = event.target.dataset;
                    
                    x = (parseFloat(x) || 0) + event.deltaRect.left;
                    y = (parseFloat(y) || 0) + event.deltaRect.top;

                    Object.assign(event.target.style, {
                        width: `${event.rect.width}px`,
                        height: `${event.rect.height}px`,
                        transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`
                    });

                    Object.assign(event.target.dataset, { x, y });
                }
            }
        });

    // Apply Signature to Backend
    applyBtn.addEventListener('click', () => {
        applyBtn.disabled = true;
        applyBtn.textContent = 'Applying...';

        const pdfContainer = document.getElementById('pdf-container');
        const pdfRect = pdfContainer.getBoundingClientRect();
        const sigRect = sigOverlay.getBoundingClientRect();

        // Calculate position relative to PDF canvas in percentages
        // Then convert to PDF points using viewport scale
        
        pdfDoc.getPage(pageNum).then(function(page) {
            const viewport = page.getViewport({scale: scale});
            
            // X, Y from top left of the container
            const xContainer = sigRect.left - pdfRect.left;
            const yContainer = sigRect.top - pdfRect.top;

            // Convert to unscaled PDF points
            const pdfX = xContainer / scale;
            // PDF coordinates y is from bottom left
            const pdfY = (pdfRect.height - yContainer - sigRect.height) / scale; 
            
            const pdfWidth = sigRect.width / scale;
            const pdfHeight = sigRect.height / scale;

            const formData = new FormData();
            formData.append('doc_id', docId);
            formData.append('signature_file', currentSignatureFile);
            formData.append('x', pdfX);
            formData.append('y', pdfY);
            formData.append('width', pdfWidth);
            formData.append('height', pdfHeight);
            formData.append('page_num', pageNum);

            fetch('/api/apply-signature/', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': csrfToken
                },
                body: formData
            })
            .then(res => res.json())
            .then(data => {
                if(data.success) {
                    document.getElementById('success-area').style.display = 'block';
                    document.getElementById('download-btn').href = data.signed_url;
                    applyBtn.textContent = 'Signature Applied';
                } else {
                    alert('Error: ' + data.error);
                    applyBtn.disabled = false;
                    applyBtn.textContent = 'Apply Signature';
                }
            })
            .catch(err => {
                alert('Request failed.');
                console.error(err);
                applyBtn.disabled = false;
                applyBtn.textContent = 'Apply Signature';
            });
        });
    });
});
