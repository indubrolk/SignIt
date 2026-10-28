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
    let isRotating = false;

    function dataURLtoBlob(dataurl) {
        const arr = dataurl.split(',');
        const mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
    }

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
        const sigControls = document.getElementById('signature-controls');
        if (sigControls) {
            sigControls.style.display = 'none';
        }
        const angleDisplay = document.getElementById('rotation-angle-display');
        if (angleDisplay) angleDisplay.textContent = '0°';
        const slider = document.getElementById('rotation-slider');
        if (slider) slider.value = 0;
    }

    function applyRotation(target, angle) {
        while (angle > 180) angle -= 360;
        while (angle < -180) angle += 360;
        target.dataset.angle = angle;

        const angleDisplay = document.getElementById('rotation-angle-display');
        if (angleDisplay) angleDisplay.textContent = `${angle}°`;
        const slider = document.getElementById('rotation-slider');
        if (slider) slider.value = angle;

        const baseImg = target._baseImg;
        if (!baseImg) return;

        const rad = (angle * Math.PI) / 180;
        const sin = Math.abs(Math.sin(rad));
        const cos = Math.abs(Math.cos(rad));
        const origW = target._origW;
        const origH = target._origH;

        const rotW = Math.max(1, Math.round(origW * cos + origH * sin));
        const rotH = Math.max(1, Math.round(origW * sin + origH * cos));

        const offscreen = document.createElement('canvas');
        offscreen.width = rotW;
        offscreen.height = rotH;
        const octx = offscreen.getContext('2d');

        octx.translate(rotW / 2, rotH / 2);
        octx.rotate(rad);
        octx.drawImage(baseImg, -origW / 2, -origH / 2);

        const newUrl = offscreen.toDataURL('image/png');
        const imgEl = target.querySelector('.signature-img');
        if (imgEl) {
            imgEl.src = newUrl;
        }

        const scale = parseFloat(target.dataset.scale) || (150 / origW);
        const newW = Math.max(20, Math.round(rotW * scale));
        const newH = Math.max(10, Math.round(rotH * scale));

        target.style.width = `${newW}px`;
        target.style.height = `${newH}px`;

        const blob = dataURLtoBlob(newUrl);
        const updatedFile = new File([blob], `signature_${target.id}.png`, { type: 'image/png' });
        signatureFiles.set(target.id, updatedFile);
    }

    function initRotateHandle(handle, sigWrapper) {
        handle.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            isRotating = true;
            try { handle.setPointerCapture(e.pointerId); } catch(err){}

            const onPointerMove = (moveEvt) => {
                if (!isRotating) return;
                const rect = sigWrapper.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                const rad = Math.atan2(moveEvt.clientY - centerY, moveEvt.clientX - centerX);
                let deg = Math.round(rad * (180 / Math.PI) + 90);

                while (deg > 180) deg -= 360;
                while (deg < -180) deg += 360;

                [-180, -90, 0, 90, 180].forEach(snap => {
                    if (Math.abs(deg - snap) <= 4) deg = snap;
                });

                applyRotation(sigWrapper, deg);
            };

            const onPointerUp = (upEvt) => {
                if (!isRotating) return;
                isRotating = false;
                try { handle.releasePointerCapture(upEvt.pointerId); } catch(err){}
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
            };

            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
        });
    }

    function addSignatureToCanvas(file, dataUrl) {
        clearExistingSignatures();
        sigCounter++;
        const sigId = `sig_${sigCounter}`;
        signatureFiles.set(sigId, file);

        const sigWrapper = document.createElement('div');
        sigWrapper.className = 'draggable-signature';
        sigWrapper.id = sigId;
        sigWrapper.dataset.pageNum = pageNum;

        // Initial position
        sigWrapper.style.transform = 'translate(-50%, -50%)';
        sigWrapper.dataset.x = 0;
        sigWrapper.dataset.y = 0;
        sigWrapper.dataset.angle = 0;
        sigWrapper.style.width = '150px';
        sigWrapper.style.height = 'auto';

        const img = document.createElement('img');
        img.src = dataUrl;
        img.className = 'signature-img';

        // Load base image for lossless offscreen rotation
        const baseImg = new Image();
        baseImg.onload = () => {
            sigWrapper._baseImg = baseImg;
            sigWrapper._origW = baseImg.naturalWidth;
            sigWrapper._origH = baseImg.naturalHeight;

            const initialWidth = 150;
            const initialScale = initialWidth / baseImg.naturalWidth;
            sigWrapper.dataset.scale = initialScale;
            sigWrapper.dataset.angle = 0;

            const initialHeight = Math.round(baseImg.naturalHeight * initialScale);
            sigWrapper.style.width = `${initialWidth}px`;
            sigWrapper.style.height = `${initialHeight}px`;

            const sigControls = document.getElementById('signature-controls');
            if (sigControls) sigControls.style.display = 'block';
            const angleDisplay = document.getElementById('rotation-angle-display');
            if (angleDisplay) angleDisplay.textContent = '0°';
            const slider = document.getElementById('rotation-slider');
            if (slider) slider.value = 0;
        };
        baseImg.src = dataUrl;

        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle';
        resizeHandle.title = 'Drag to resize';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-sig-btn';
        deleteBtn.title = 'Remove signature';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            clearExistingSignatures();
        };

        const rotateBtn = document.createElement('button');
        rotateBtn.className = 'rotate-sig-btn';
        rotateBtn.title = 'Rotate 90° Clockwise';
        rotateBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                <path d="M21 3v5h-5"/>
            </svg>
        `;
        rotateBtn.onclick = (e) => {
            e.stopPropagation();
            let currentAngle = parseInt(sigWrapper.dataset.angle) || 0;
            let newAngle = currentAngle + 90;
            if (newAngle > 180) newAngle -= 360;
            applyRotation(sigWrapper, newAngle);
        };

        const rotateHandle = document.createElement('div');
        rotateHandle.className = 'rotate-handle';
        rotateHandle.title = 'Drag to rotate';
        const rotateKnob = document.createElement('div');
        rotateKnob.className = 'rotate-handle-knob';
        rotateHandle.appendChild(rotateKnob);
        initRotateHandle(rotateHandle, sigWrapper);

        sigWrapper.appendChild(deleteBtn);
        sigWrapper.appendChild(rotateBtn);
        sigWrapper.appendChild(rotateHandle);
        sigWrapper.appendChild(img);
        sigWrapper.appendChild(resizeHandle);
        pdfContainer.appendChild(sigWrapper);

        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm Signature';
        }
        applyBtn.disabled = true;
    }

    // Sidebar rotation control handlers
    const rotateCwBtn = document.getElementById('rotate-cw-btn');
    if (rotateCwBtn) {
        rotateCwBtn.addEventListener('click', () => {
            const activeSig = document.querySelector('.draggable-signature');
            if (!activeSig) return;
            let currentAngle = parseInt(activeSig.dataset.angle) || 0;
            let newAngle = currentAngle + 90;
            if (newAngle > 180) newAngle -= 360;
            applyRotation(activeSig, newAngle);
        });
    }

    const rotateCcwBtn = document.getElementById('rotate-ccw-btn');
    if (rotateCcwBtn) {
        rotateCcwBtn.addEventListener('click', () => {
            const activeSig = document.querySelector('.draggable-signature');
            if (!activeSig) return;
            let currentAngle = parseInt(activeSig.dataset.angle) || 0;
            let newAngle = currentAngle - 90;
            if (newAngle < -180) newAngle += 360;
            applyRotation(activeSig, newAngle);
        });
    }

    const rotateResetBtn = document.getElementById('rotate-reset-btn');
    if (rotateResetBtn) {
        rotateResetBtn.addEventListener('click', () => {
            const activeSig = document.querySelector('.draggable-signature');
            if (!activeSig) return;
            applyRotation(activeSig, 0);
        });
    }

    const rotationSlider = document.getElementById('rotation-slider');
    if (rotationSlider) {
        rotationSlider.addEventListener('input', (e) => {
            const activeSig = document.querySelector('.draggable-signature');
            if (!activeSig) return;
            applyRotation(activeSig, parseInt(e.target.value) || 0);
        });
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
                if (resize) resize.style.display = 'none';
                const del = sig.querySelector('.delete-sig-btn');
                if (del) del.style.display = 'none';
                const rot = sig.querySelector('.rotate-sig-btn');
                if (rot) rot.style.display = 'none';
                const rotHandle = sig.querySelector('.rotate-handle');
                if (rotHandle) rotHandle.style.display = 'none';
            });

            const sigControls = document.getElementById('signature-controls');
            if (sigControls) sigControls.style.display = 'none';

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
            ignoreFrom: '.delete-sig-btn, .rotate-sig-btn, .rotate-handle, .resize-handle',
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

                    const angle = parseFloat(target.dataset.angle) || 0;
                    const rad = (angle * Math.PI) / 180;
                    const origW = target._origW;
                    const origH = target._origH;
                    if (origW && origH) {
                        const cos = Math.abs(Math.cos(rad));
                        const sin = Math.abs(Math.sin(rad));
                        const currentRotatedW = origW * cos + origH * sin;
                        target.dataset.scale = event.rect.width / currentRotatedW;
                    }
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
