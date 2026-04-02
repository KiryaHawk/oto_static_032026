let currentMinQuantity = 0;
let showGibdd = true;
let selectedCategories = new Set();
let allCategories = [];

ymaps.ready(init);

function init() {
    fetch('open.json')
        .then(response => response.json())
        .then(obj => {
            const searchControls = new ymaps.control.SearchControl({
                options: {
                    float: 'right',
                    noPlacemark: true
                }
            });

            const myMap = new ymaps.Map('map', {
                center: [55.76, 37.64],
                zoom: 7,
                controls: [searchControls]
            });

            const removeControls = [
                'geolocationControl',
                'trafficControl',
                'fullscreenControl',
                'zoomControl',
                'rulerControl',
                'typeSelector'
            ];
            removeControls.forEach(ctrl => myMap.controls.remove(ctrl));

            const objectManager = new ymaps.ObjectManager({
                clusterize: true,
                clusterIconLayout: 'default#pieChart'
            });

            let minLatitude = Infinity;
            let maxLatitude = -Infinity;
            let minLongitude = Infinity;
            let maxLongitude = -Infinity;

            let minQuantity = Infinity;
            let maxQuantity = -Infinity;

            const validFeatures = [];
            const categorySet = new Set();

            obj.features.forEach(feature => {
                if (!feature.geometry || !Array.isArray(feature.geometry.coordinates)) return;

                const coords = feature.geometry.coordinates;
                if (coords.length < 2) return;

                const longitude = Number(coords[0]);
                const latitude = Number(coords[1]);

                if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

                // Яндексу нужен формат [lat, lon]
                feature.geometry.coordinates = [latitude, longitude];

                minLatitude = Math.min(minLatitude, latitude);
                maxLatitude = Math.max(maxLatitude, latitude);
                minLongitude = Math.min(minLongitude, longitude);
                maxLongitude = Math.max(maxLongitude, longitude);

                if (!feature.properties) feature.properties = {};

                const quantity = extractQuantity(feature);
                const categories = extractCategories(feature);

                feature.properties.quantity = quantity;
                feature.properties.categoryList = categories;
                feature.properties.categoryNormalized = categories.join(', ');

                categories.forEach(cat => categorySet.add(cat));

                const preset = feature.options && feature.options.preset;
                const isBlue = preset === 'islands#blueIcon';

                if (!isBlue) {
                    if (quantity === null) return;

                    if (quantity < minQuantity) minQuantity = quantity;
                    if (quantity > maxQuantity) maxQuantity = quantity;
                }

                validFeatures.push(feature);
            });

            if (validFeatures.length === 0) {
                console.warn('Нет точек для отображения.');
                return;
            }

            if (minQuantity === Infinity || maxQuantity === -Infinity) {
                minQuantity = 0;
                maxQuantity = 0;
            }

            obj.features = validFeatures;

            objectManager.removeAll();
            objectManager.add(obj);
            myMap.geoObjects.add(objectManager);

            if (
                minLatitude !== Infinity &&
                maxLatitude !== -Infinity &&
                minLongitude !== Infinity &&
                maxLongitude !== -Infinity
            ) {
                myMap.setBounds(
                    [
                        [minLatitude, minLongitude],
                        [maxLatitude, maxLongitude]
                    ],
                    { checkZoomRange: true }
                );
            }

            allCategories = sortCategories(Array.from(categorySet));

            setupFilterUI(minQuantity, maxQuantity, objectManager, allCategories);
            applyFilter(currentMinQuantity, objectManager);
        })
        .catch(err => {
            console.error('Ошибка загрузки open.json:', err);
        });
}

function extractQuantity(feature) {
    if (!feature.properties) return null;

    if (
        feature.properties.quantity !== undefined &&
        feature.properties.quantity !== null &&
        feature.properties.quantity !== ''
    ) {
        const q = Number(feature.properties.quantity);
        if (Number.isFinite(q)) return q;
    }

    const body = feature.properties.balloonContentBody;
    if (typeof body === 'string') {
        const re = /Кол-во\s+ДК\s+за\s+месяц:\s*<span[^>]*>([\d\s]+)/i;
        const match = body.match(re);
        if (match && match[1]) {
            const q = parseInt(match[1].replace(/\s+/g, ''), 10);
            if (!isNaN(q)) return q;
        }
    }

    return null;
}

function extractCategories(feature) {
    if (!feature.properties) return [];

    let raw = '';

    if (
        feature.properties.category !== undefined &&
        feature.properties.category !== null &&
        String(feature.properties.category).trim() !== ''
    ) {
        raw = String(feature.properties.category).trim();
    } else {
        const body = feature.properties.balloonContentBody;
        if (typeof body === 'string') {
            const re = /Категория:<\/span>\s*([^<]+)/i;
            const match = body.match(re);
            if (match && match[1]) {
                raw = match[1].trim();
            }
        }
    }

    if (!raw) return [];

    return raw
        .split(/[;,|]/)
        .map(item => item.trim())
        .filter(Boolean)
        .filter((item, index, arr) => arr.indexOf(item) === index);
}

function sortCategories(categories) {
    const desiredOrder = [
        'A(L)',
        'B(M1)',
        'B(N1)',
        'C(N2)',
        'C(N3)',
        'E(O1)',
        'E(O2)',
        'E(O3)',
        'E(O4)'
    ];

    return categories.sort((a, b) => {
        const ia = desiredOrder.indexOf(a);
        const ib = desiredOrder.indexOf(b);

        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;

        return a.localeCompare(b, 'ru');
    });
}

function setupFilterUI(minQuantity, maxQuantity, objectManager, categories) {
    const dkToggleBtn = document.getElementById('dk-filter-toggle');
    const categoryToggleBtn = document.getElementById('category-filter-toggle');
    const gibddToggle = document.getElementById('gibdd-toggle');

    const dkPanel = document.getElementById('dk-filter-panel');
    const categoryPanel = document.getElementById('category-filter-panel');

    const range = document.getElementById('quantity-range');
    const input = document.getElementById('quantity-input');
    const currentValueLabel = document.getElementById('filter-current-value');

    const categoryList = document.getElementById('category-checkboxes');
    const btnSelectAll = document.getElementById('categories-select-all');
    const btnClearAll = document.getElementById('categories-clear-all');

    if (
        !dkToggleBtn || !categoryToggleBtn || !gibddToggle ||
        !dkPanel || !categoryPanel ||
        !range || !input || !currentValueLabel ||
        !categoryList || !btnSelectAll || !btnClearAll
    ) {
        console.warn('Элементы фильтра не найдены.');
        return;
    }

    dkPanel.style.display = 'none';
    categoryPanel.style.display = 'none';

    range.min = minQuantity;
    range.max = minQuantity === maxQuantity ? maxQuantity + 1 : maxQuantity;
    range.step = 1;
    range.value = minQuantity;

    input.min = minQuantity;
    input.max = maxQuantity;
    input.step = 1;
    input.value = minQuantity;

    currentMinQuantity = minQuantity;
    updateCurrentValueLabel(minQuantity);

    categoryList.innerHTML = '';

    categories.forEach(category => {
        const label = document.createElement('label');
        label.className = 'category-check-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = category;
        checkbox.checked = false;

        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                selectedCategories.add(category);
            } else {
                selectedCategories.delete(category);
            }
            applyFilter(currentMinQuantity, objectManager);
        });

        const text = document.createElement('span');
        text.textContent = category;

        label.appendChild(checkbox);
        label.appendChild(text);
        categoryList.appendChild(label);
    });

    dkToggleBtn.addEventListener('click', () => {
        const isOpen = dkPanel.style.display === 'block';
        dkPanel.style.display = isOpen ? 'none' : 'block';
        if (!isOpen) categoryPanel.style.display = 'none';
    });

    categoryToggleBtn.addEventListener('click', () => {
        const isOpen = categoryPanel.style.display === 'block';
        categoryPanel.style.display = isOpen ? 'none' : 'block';
        if (!isOpen) dkPanel.style.display = 'none';
    });

    showGibdd = true;
    gibddToggle.classList.add('active');

    gibddToggle.addEventListener('click', () => {
        showGibdd = !showGibdd;
        gibddToggle.classList.toggle('active', showGibdd);
        applyFilter(currentMinQuantity, objectManager);
    });

    range.addEventListener('input', () => {
        const val = parseInt(range.value, 10);
        input.value = val;
        updateCurrentValueLabel(val);
        applyFilter(val, objectManager);
    });

    input.addEventListener('input', () => {
        let val = parseInt(input.value, 10);
        if (isNaN(val)) val = minQuantity;
        if (val < minQuantity) val = minQuantity;
        if (val > maxQuantity) val = maxQuantity;

        input.value = val;
        range.value = val;
        updateCurrentValueLabel(val);
        applyFilter(val, objectManager);
    });

    btnSelectAll.addEventListener('click', () => {
        selectedCategories = new Set(categories);
        categoryList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = true;
        });
        applyFilter(currentMinQuantity, objectManager);
    });

    btnClearAll.addEventListener('click', () => {
        selectedCategories.clear();
        categoryList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
        });
        applyFilter(currentMinQuantity, objectManager);
    });

    function updateCurrentValueLabel(minVal) {
        currentValueLabel.textContent = `Показываются точки с кол-вом ≥ ${minVal}`;
    }
}

function applyFilter(minQuantity, objectManager) {
    currentMinQuantity = minQuantity;

    if (!objectManager) return;

    const selectedCount = selectedCategories.size;
    const allCount = allCategories.length;

    objectManager.setFilter(obj => {
        const preset = obj.options && obj.options.preset;
        const isBlue = preset === 'islands#blueIcon';

        // ГИБДД управляется только своей кнопкой
        if (isBlue) {
            return showGibdd;
        }

        const objCategories = extractCategories(obj);

        // Категориальный фильтр ТОЛЬКО для обычных точек:
        // ничего не выбрано -> показать все
        // выбраны все -> показать все
        // иначе объект должен содержать все выбранные категории
        const categoryFilterIsOff =
            selectedCount === 0 || selectedCount === allCount;

        if (!categoryFilterIsOff) {
            for (const selected of selectedCategories) {
                if (!objCategories.includes(selected)) {
                    return false;
                }
            }
        }

        const q = extractQuantity(obj);
        if (q === null) return false;

        return q >= currentMinQuantity;
    });
}