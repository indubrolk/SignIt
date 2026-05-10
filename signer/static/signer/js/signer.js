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
    const pdfContainer = document.getElementById('pdf-container');

    // UI Elements
    const applyBtn = document.getElementById('apply-btn');
    const confirmBtn = document.getElementById('confirm-btn');

    // PDF rendering
    function renderPage(num) {
        pageRendering = true;
        pdfDoc.getPage(num).then(function (page) {
            const viewport = page.getViewport({ scale: scale });
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            const renderContext = {
                canvasContext: ctx,
                viewport: viewport
            };
            const renderTask = page.render(renderContext);

            renderTask.promise.then(function () {
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
    pdfjsLib.getDocument(pdfUrl).promise.then(function (pdfDoc_) {
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
    let drawColor = '#000000';
    let drawThickness = 3;

    // Set white background for drawing canvas so it's not transparent
    drawCtx.fillStyle = 'transparent';
    drawCtx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);

    function updateDrawContext() {
        drawCtx.lineWidth = drawThickness;
        drawCtx.lineCap = 'round';
        drawCtx.strokeStyle = drawColor;
    }
    updateDrawContext();

    // Drawing Controls
    document.querySelectorAll('.color-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            drawColor = e.target.dataset.color;
            updateDrawContext();
        });
    });

    const thicknessSlider = document.getElementById('draw-thickness');
    const thicknessVal = document.getElementById('thickness-val');
    thicknessSlider.addEventListener('input', (e) => {
        drawThickness = e.target.value;
        thicknessVal.textContent = drawThickness;
        updateDrawContext();
    });

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
    drawCanvas.addEventListener('mouseout', endPosition);

    drawCanvas.addEventListener('touchstart', startPosition, { passive: true });
    drawCanvas.addEventListener('touchend', endPosition);
    drawCanvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        draw(e);
    }, { passive: false });

    document.getElementById('clear-canvas').addEventListener('click', () => {
        drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    });

    // Signature Management
    const signatureFiles = new Map();
    let sigCounter = 0;

    function clearExistingSignatures() {
        signatureFiles.clear();
        document.querySelectorAll('.draggable-signature').forEach(sig => sig.remove());
        applyBtn.disabled = true;
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Confirm Signature';
        }
        applyBtn.textContent = 'Apply Signature';
        const successArea = document.getElementById('success-area');
        if (successArea) {
            successArea.style.display = 'none';
        }
    }

    function addSignatureToCanvas(file, dataUrl) {
        clearExistingSignatures();
        sigCounter++;
        const sigId = `sig_${sigCounter}`;
        signatureFiles.set(sigId, file);

        const sigWrapper = document.createElement('div');
        sigWrapper.className = 'draggable-signature';
        sigWrapper.id = sigId;
        sigWrapper.dataset.pageNum = pageNum; // Track which page it was placed on

        // Initial position
        sigWrapper.style.transform = 'translate(-50%, -50%)';
        sigWrapper.dataset.x = 0;
        sigWrapper.dataset.y = 0;
        sigWrapper.style.width = '150px';
        sigWrapper.style.height = 'auto';

        const img = document.createElement('img');
        img.src = dataUrl;
        img.className = 'signature-img';

        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-sig-btn';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            clearExistingSignatures();
        };

        sigWrapper.appendChild(deleteBtn);
        sigWrapper.appendChild(img);
        sigWrapper.appendChild(resizeHandle);
        pdfContainer.appendChild(sigWrapper);

        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm Signature';
        }
        applyBtn.disabled = true;
    }

    // Upload PNG Logic
    document.getElementById('sig-upload').addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = function (evt) {
                addSignatureToCanvas(file, evt.target.result);
            }
            reader.readAsDataURL(file);
            e.target.value = ''; // reset
        }
    });

    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            if (signatureFiles.size === 0) return;

            document.querySelectorAll('.draggable-signature').forEach(sig => {
                interact(sig).draggable(false).resizable(false);
                const resize = sig.querySelector('.resize-handle');
                if (resize) {
                    resize.style.display = 'none';
                }
                const del = sig.querySelector('.delete-sig-btn');
                if (del) {
                    del.style.display = 'none';
                }
            });

            confirmBtn.textContent = 'Confirmed';
            confirmBtn.disabled = true;
            applyBtn.disabled = false;
        });
    }

    // Add Drawn Signature
    document.getElementById('add-drawn-sig').addEventListener('click', () => {
        drawCanvas.toBlob((blob) => {
            const file = new File([blob], `drawn_sig_${Date.now()}.png`, { type: "image/png" });
            const dataUrl = URL.createObjectURL(blob);
            addSignatureToCanvas(file, dataUrl);

            // clear canvas automatically after adding
            drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        }, 'image/png');
    });

    // Interact.js for drag and resize
    interact('.draggable-signature')
        .draggable({
            listeners: {
                move(event) {
                    const target = event.target;
                    const x = (parseFloat(target.dataset.x) || 0) + event.dx;
                    const y = (parseFloat(target.dataset.y) || 0) + event.dy;

                    target.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
                    target.dataset.x = x;
                    target.dataset.y = y;
                },
            }
        })
        .resizable({
            edges: { left: false, right: '.resize-handle', bottom: '.resize-handle', top: false },
            modifiers: [
                interact.modifiers.aspectRatio({
                    ratio: 'preserve',
                })
            ],
            listeners: {
                move(event) {
                    const target = event.target;
                    let x = (parseFloat(target.dataset.x) || 0) + event.deltaRect.left;
                    let y = (parseFloat(target.dataset.y) || 0) + event.deltaRect.top;

                    Object.assign(target.style, {
                        width: `${event.rect.width}px`,
                        height: `${event.rect.height}px`,
                        transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`
                    });

                    Object.assign(target.dataset, { x, y });
                }
            }
        });

    // Hide/Show signatures based on current page
    document.getElementById('prev-page').addEventListener('click', updateSignaturesVisibility);
    document.getElementById('next-page').addEventListener('click', updateSignaturesVisibility);

    function updateSignaturesVisibility() {
        document.querySelectorAll('.draggable-signature').forEach(sig => {
            if (parseInt(sig.dataset.pageNum) === pageNum) {
                sig.style.display = 'block';
            } else {
                sig.style.display = 'none';
            }
        });
    }

    // Apply Signatures to Backend
    applyBtn.addEventListener('click', () => {
        if (signatureFiles.size === 0) return;

        applyBtn.disabled = true;
        applyBtn.textContent = 'Applying...';

        const pdfRect = pdfContainer.getBoundingClientRect();

        const signaturesData = [];
        const formData = new FormData();
        formData.append('doc_id', docId);

        let promises = [];

        // Wait for page info to calculate correct points for all signatures
        // Actually, we can get viewport for each signature's page
        document.querySelectorAll('.draggable-signature').forEach(sigOverlay => {
            const sigId = sigOverlay.id;
            const sigPageNum = parseInt(sigOverlay.dataset.pageNum);

            // To properly calculate coordinates, we need the viewport of the page the signature belongs to
            let promise = pdfDoc.getPage(sigPageNum).then(function (page) {
                const viewport = page.getViewport({ scale: scale });
                const sigRect = sigOverlay.getBoundingClientRect();

                // If the signature is not on the current page, its bounding rect might be 0,0
                // We need to briefly show it to get bounds, or calculate from stored styles.
                // Since it's absolutely positioned in the center with transforms:
                const width = parseFloat(sigOverlay.style.width) || sigRect.width;
                const height = parseFloat(sigOverlay.style.height) || sigRect.height;
                const dx = parseFloat(sigOverlay.dataset.x) || 0;
                const dy = parseFloat(sigOverlay.dataset.y) || 0;

                // Calculate center point of container
                const centerX = pdfRect.width / 2;
                const centerY = pdfRect.height / 2;

                // Top left in container
                const xContainer = centerX + dx - (width / 2);
                const yContainer = centerY + dy - (height / 2);

                const pdfX = xContainer / scale;
                const pdfY = (pdfRect.height - yContainer - height) / scale;
                const pdfWidth = width / scale;
                const pdfHeight = height / scale;

                signaturesData.push({
                    id: sigId,
                    page_num: sigPageNum,
                    x: pdfX,
                    y: pdfY,
                    width: pdfWidth,
                    height: pdfHeight
                });

                formData.append(`file_${sigId}`, signatureFiles.get(sigId));
            });
            promises.push(promise);
        });

        Promise.all(promises).then(() => {
            formData.append('signatures_data', JSON.stringify(signaturesData));

            fetch('/api/apply-signature/', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': csrfToken
                },
                body: formData
            })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        document.getElementById('success-area').style.display = 'block';
                        const downloadUrl = data.download_url;
                        if (downloadUrl) {
                            document.getElementById('download-btn').href = downloadUrl;
                        }
                        applyBtn.textContent = 'Signatures Applied';

                        // Trigger download via normal navigation to avoid opening a file picker.
                        if (downloadUrl) {
                            window.location.assign(downloadUrl);
                        }

                        // Hide UI controls
                        document.querySelectorAll('.delete-sig-btn').forEach(btn => btn.style.display = 'none');
                    } else {
                        alert('Error: ' + data.error);
                        applyBtn.disabled = false;
                        applyBtn.textContent = 'Apply Signatures';
                    }
                })
                .catch(err => {
                    alert('Request failed.');
                    console.error(err);
                    applyBtn.disabled = false;
                    applyBtn.textContent = 'Apply Signatures';
                });
        });
    });
});
