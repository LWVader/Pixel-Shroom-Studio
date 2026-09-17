"use strict";

/**
 * The Iron Briers 3D COLLECTIBLE CARD
 *
 * Features:
 * - Rounded physical 3D card shell
 * - Visible card thickness
 * - Front/back faces
 * - Generated 3D gold coins
 * - Pointer/touch/pen rotation
 * - Momentum/inertia
 * - Public rotation API
 */

(() => {
    /* =========================================================
       1. CONFIGURATION
       ========================================================= */

    const CONFIG = Object.freeze({
        width: 340,
        height: 520,

        // Physical card geometry.
        depth: 22,
        radius: 24,
        cornerSegments: 12,

        // Prevent front/back z-fighting.
        faceOffset: 0.05,

        // Interaction.
        dragSensitivity: 0.32,
        momentum: 0.94,
        smoothing: 0.18,

        initialRotationX: -4,
        initialRotationY: -22,

        maxRotationX: 35,

        // Gold coins.
        coin: Object.freeze({
        frontSize: 64,
        backSize: 52,

        // Reduced physical extrusion.
        depth: 6,

        segments: 64,

        // Recess coin slightly into card surface.
        surfaceGap: -2,

        frontRight: 14,
        frontBottom: 38,

        backLeft: 20,
        backTop: 20
    })
    });

    /* =========================================================
       2. UTILITIES
       ========================================================= */

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function isFiniteNumber(value) {
        return Number.isFinite(Number(value));
    }

    /* =========================================================
       3. FIND REQUIRED ELEMENTS
       ========================================================= */

    const stage = document.getElementById("cardStage");
    const card = document.getElementById("card");

    if (!stage || !card) {
        console.error(
            "The Iron Briers3D: expected #cardStage and #card elements."
        );
        return;
    }

    const front = card.querySelector(".card-front");
    const back = card.querySelector(".card-back");

    if (!front || !back) {
        console.error(
            "The Iron Briers3D: .card-front and .card-back are required."
        );
        return;
    }

    /* =========================================================
       4. CLEAN UP PREVIOUS GENERATED INSTANCE
       ========================================================= */

    card.querySelectorAll(
        [
            ".card-body",
            ".card-edge",
            ".depth-layer",
            ".edge-corner",
            ".corner-fill",
            ".generated-card-shell",
            ".generated-coin"
        ].join(", ")
    ).forEach((element) => {
        element.remove();
    });

    /* =========================================================
       5. BASIC 3D SETUP
       ========================================================= */

    Object.assign(stage.style, {
        width: `${CONFIG.width}px`,
        height: `${CONFIG.height}px`,
        position: "relative",
        transformStyle: "preserve-3d",
        touchAction: "none"
    });

    Object.assign(card.style, {
        position: "relative",
        width: "100%",
        height: "100%",
        transformStyle: "preserve-3d",
        willChange: "transform"
    });

    const halfDepth = CONFIG.depth / 2;
    const faceZ = halfDepth + CONFIG.faceOffset;

    Object.assign(front.style, {
        transform: `translateZ(${faceZ}px)`,
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden"
    });

    Object.assign(back.style, {
        transform: `rotateY(180deg) translateZ(${faceZ}px)`,
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden"
    });

    /* =========================================================
       6. CREATE PHYSICAL CARD SHELL
       ========================================================= */

    const shell = document.createElement("div");

    shell.className = "generated-card-shell";

    Object.assign(shell.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        transformStyle: "preserve-3d",
        pointerEvents: "none"
    });

    card.insertBefore(shell, card.firstChild);

    /* =========================================================
       7. ROUNDED RECTANGLE PERIMETER
       ========================================================= */

    function createRoundedRectanglePoints(
        width,
        height,
        radius,
        cornerSegments
    ) {
        const points = [];

        const safeRadius = clamp(
            radius,
            0,
            Math.min(width, height) / 2
        );

        const segments = Math.max(
            1,
            Math.floor(cornerSegments)
        );

        const left = -width / 2;
        const right = width / 2;
        const top = -height / 2;
        const bottom = height / 2;

        function addArc(cx, cy, startAngle, endAngle) {
            for (let i = 0; i <= segments; i += 1) {
                const progress = i / segments;

                const angle =
                    startAngle +
                    (endAngle - startAngle) * progress;

                points.push({
                    x: cx + Math.cos(angle) * safeRadius,
                    y: cy + Math.sin(angle) * safeRadius
                });
            }
        }

        // Top-right.
        addArc(
            right - safeRadius,
            top + safeRadius,
            -Math.PI / 2,
            0
        );

        // Bottom-right.
        addArc(
            right - safeRadius,
            bottom - safeRadius,
            0,
            Math.PI / 2
        );

        // Bottom-left.
        addArc(
            left + safeRadius,
            bottom - safeRadius,
            Math.PI / 2,
            Math.PI
        );

        // Top-left.
        addArc(
            left + safeRadius,
            top + safeRadius,
            Math.PI,
            Math.PI * 1.5
        );

        return points;
    }

    /* =========================================================
       8. CARD EDGE LIGHTING
       ========================================================= */

    function getSegmentGradient(pointA, pointB) {
        const middleX = (pointA.x + pointB.x) / 2;
        const middleY = (pointA.y + pointB.y) / 2;

        const horizontal =
            middleX / (CONFIG.width / 2);

        const vertical =
            middleY / (CONFIG.height / 2);

        let light = 0;

        light += -horizontal * 12;
        light += -vertical * 8;

        const base = 112 + light;

        const r1 = clamp(base + 22, 75, 170);
        const g1 = clamp(base - 58, 25, 90);
        const b1 = clamp(base + 40, 100, 195);

        const r2 = clamp(base + 3, 60, 145);
        const g2 = clamp(base - 68, 20, 75);
        const b2 = clamp(base + 21, 85, 170);

        return `
            linear-gradient(
                180deg,
                rgb(${r1}, ${g1}, ${b1}) 0%,
                rgb(${r2}, ${g2}, ${b2}) 42%,
                #71318a 58%,
                #582468 100%
            )
        `;
    }

    /* =========================================================
       9. CREATE CARD WALL SEGMENT
       ========================================================= */

    function createWallSegment(pointA, pointB, index) {
        const dx = pointB.x - pointA.x;
        const dy = pointB.y - pointA.y;

        const length = Math.hypot(dx, dy);

        if (length < 0.01) {
            return;
        }

        const centerX = (pointA.x + pointB.x) / 2;
        const centerY = (pointA.y + pointB.y) / 2;

        const angle =
            Math.atan2(dy, dx) * (180 / Math.PI);

        const overlap = 0.8;
        const wallWidth = length + overlap;

        const wall = document.createElement("div");

        wall.className = "card-shell-segment";
        wall.dataset.segment = String(index);

        Object.assign(wall.style, {
            position: "absolute",

            width: `${wallWidth}px`,
            height: `${CONFIG.depth}px`,

            left: "50%",
            top: "50%",

            marginLeft: `${-wallWidth / 2}px`,
            marginTop: `${-CONFIG.depth / 2}px`,

            transformOrigin: "50% 50%",
            transformStyle: "preserve-3d",

            transform:
                `translate3d(${centerX}px, ${centerY}px, 0) ` +
                `rotateZ(${angle}deg) ` +
                "rotateX(90deg)",

            background: getSegmentGradient(
                pointA,
                pointB
            ),

            backfaceVisibility: "visible",
            WebkitBackfaceVisibility: "visible",

            boxShadow:
                "inset 0 1px 1px rgba(255,255,255,.20), " +
                "inset 0 -1px 2px rgba(31,5,42,.22)",

            pointerEvents: "none"
        });

        shell.appendChild(wall);
    }

    /* =========================================================
       10. FRONT/BACK RIMS
       ========================================================= */

    function createRim(z, isBack = false) {
        const rim = document.createElement("div");

        rim.className =
            `generated-card-rim ${
                isBack ? "back-rim" : "front-rim"
            }`;

        Object.assign(rim.style, {
            position: "absolute",
            inset: "0",

            borderRadius: `${CONFIG.radius}px`,

            border:
                "2px solid rgba(218,140,255,.48)",

            boxSizing: "border-box",

            boxShadow:
                "inset 2px 2px 2px rgba(255,255,255,.18), " +
                "inset -2px -2px 3px rgba(35,5,48,.18)",

            transform:
                `${isBack ? "rotateY(180deg) " : ""}` +
                `translateZ(${z}px)`,

            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",

            pointerEvents: "none"
        });

        shell.appendChild(rim);
    }

    /* =========================================================
       11. BUILD COMPLETE CARD SHELL

       Important:
       The rims are rebuilt here as well. This prevents
       rebuild() from deleting them permanently.
       ========================================================= */

    function buildShell() {
        shell.replaceChildren();

        const points = createRoundedRectanglePoints(
            CONFIG.width,
            CONFIG.height,
            CONFIG.radius,
            CONFIG.cornerSegments
        );

        for (let i = 0; i < points.length; i += 1) {
            const current = points[i];
            const next = points[(i + 1) % points.length];

            createWallSegment(current, next, i);
        }

        createRim(halfDepth, false);
        createRim(halfDepth, true);
    }

    buildShell();

    /* =========================================================
       12. REMOVE OLD COINS
       ========================================================= */

    front
        .querySelectorAll(".coin-3d")
        .forEach((coin) => coin.remove());

    back
        .querySelectorAll(".coin-3d")
        .forEach((coin) => coin.remove());

    /* =========================================================
       13. CREATE GOLD COIN FACE
       ========================================================= */

    function createCoinFace(size, depth, isBack) {
        const face = document.createElement("div");

        face.className = isBack
            ? "generated-coin-back"
            : "gold-coin generated-coin-face";

        Object.assign(face.style, {
            position: "absolute",
            inset: "0",

            boxSizing: "border-box",

            display: "flex",
            alignItems: "center",
            justifyContent: "center",

            borderRadius: "50%",

            border:
                `${Math.max(
                    3,
                    size * 0.055
                )}px solid #ffc400`,

            background: `
                radial-gradient(
                    circle at 28% 22%,
                    #fffbd0 0%,
                    #fff36a 7%,
                    #ffe527 17%,
                    #ffc900 42%,
                    #f1a900 67%,
                    #b96e00 87%,
                    #784100 100%
                )
            `,

            boxShadow: `
                inset 3px 3px 3px rgba(255,255,225,.95),
                inset 1px 1px 0 rgba(255,255,255,.95),
                inset -3px -4px 4px rgba(126,66,0,.55),
                inset 0 0 0 1px rgba(255,236,90,.80),
                0 2px 3px rgba(70,30,0,.25)
            `,

            transform: isBack
                ? `rotateY(180deg) translateZ(${depth / 2}px)`
                : `translateZ(${depth / 2}px)`,

            transformStyle: "preserve-3d",

            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",

            overflow: "hidden"
        });

        /* -------------------------
           Decorative outer ring
           ------------------------- */

        const outerRing = document.createElement("div");

        Object.assign(outerRing.style, {
            position: "absolute",

            inset: `${size * 0.075}px`,

            borderRadius: "50%",

            border:
                `${Math.max(
                    1.2,
                    size * 0.025
                )}px solid rgba(255,242,80,.95)`,

            boxShadow: `
                0 0 0 1px rgba(176,101,0,.55),
                inset 1px 1px 2px rgba(255,255,220,.85),
                inset -1px -1px 2px rgba(137,75,0,.45)
            `,

            pointerEvents: "none"
        });

        face.appendChild(outerRing);

        /* -------------------------
           Recessed inner field
           ------------------------- */

        const field = document.createElement("div");

        Object.assign(field.style, {
            position: "absolute",

            inset: `${size * 0.145}px`,

            borderRadius: "50%",

            background: `
                radial-gradient(
                    circle at 35% 30%,
                    #ffe94c 0%,
                    #ffd51a 42%,
                    #f3b600 72%,
                    #c77c00 100%
                )
            `,

            border:
                `${Math.max(
                    1,
                    size * 0.018
                )}px solid rgba(197,119,0,.72)`,

            boxShadow: `
                inset 2px 2px 3px rgba(136,72,0,.34),
                inset -2px -2px 3px rgba(255,246,91,.68),
                0 1px 1px rgba(255,255,210,.55)
            `,

            pointerEvents: "none"
        });

        face.appendChild(field);

        /* -------------------------
           Star extrusion/shadow
           ------------------------- */

        const starShadow = document.createElement("span");

        starShadow.textContent = "★";

        Object.assign(starShadow.style, {
            position: "absolute",

            left: "50%",
            top: "50%",

            transform:
                "translate(-46%, -44%) scale(0.94)",

            color: "#d99b00",

            fontSize:
                `${Math.round(size * 0.52)}px`,

            fontWeight: "900",
            lineHeight: "1",

            textShadow:
                "1px 2px 1px rgba(111,58,0,.30)",

            userSelect: "none",
            pointerEvents: "none"
        });

        face.appendChild(starShadow);

        /* -------------------------
           Raised star
           ------------------------- */

        const star = document.createElement("span");

        star.textContent = "★";
        star.className = "coin-star";

        Object.assign(star.style, {
            position: "absolute",

            left: "50%",
            top: "50%",

            transform:
                "translate(-50%, -52%)",

            color: "#fff72b",

            fontSize:
                `${Math.round(size * 0.50)}px`,

            fontWeight: "900",
            lineHeight: "1",

            textShadow: `
                -1px -1px 0 rgba(255,255,180,.95),
                1px 1px 0 rgba(218,150,0,.65),
                1px 2px 2px rgba(126,67,0,.28)
            `,

            filter:
                "drop-shadow(0 1px 0 rgba(255,248,120,.75))",

            userSelect: "none",
            pointerEvents: "none"
        });

        face.appendChild(star);

        /* -------------------------
           Specular highlight
           ------------------------- */

        const highlight = document.createElement("div");

        Object.assign(highlight.style, {
            position: "absolute",

            left: "13%",
            top: "8%",

            width: "52%",
            height: "31%",

            borderRadius: "50%",

            background: `
                linear-gradient(
                    155deg,
                    rgba(255,255,255,.78) 0%,
                    rgba(255,255,190,.40) 34%,
                    rgba(255,255,255,0) 72%
                )
            `,

            transform: "rotate(-18deg)",
            filter: "blur(.25px)",

            pointerEvents: "none"
        });

        face.appendChild(highlight);

        /* -------------------------
           Edge glint
           ------------------------- */

        const glint = document.createElement("div");

        Object.assign(glint.style, {
            position: "absolute",

            right: "8%",
            bottom: "14%",

            width: "24%",
            height: "8%",

            borderRadius: "50%",

            background:
                "rgba(255,239,80,.55)",

            transform: "rotate(-35deg)",
            filter: "blur(1px)",

            pointerEvents: "none"
        });

        face.appendChild(glint);

        return face;
    }

    /* =========================================================
       14. CREATE PHYSICAL COIN EDGE
       ========================================================= */

    function createCoinWall(
        container,
        size,
        depth,
        segmentCount
    ) {
        const segments = Math.max(
            8,
            Math.floor(segmentCount)
        );

        const radius = size / 2 - 1.8;

        const circumference =
            2 * Math.PI * radius;

        const segmentWidth =
            circumference / segments + 1;

        for (let i = 0; i < segments; i += 1) {
            const angle =
                (i / segments) * Math.PI * 2;

            const degrees =
                angle * (180 / Math.PI);

            const x =
                Math.cos(angle) * radius;

            const y =
                Math.sin(angle) * radius;

            const mainLight =
                Math.cos(
                    angle + Math.PI * 0.72
                );

            const secondaryLight =
                Math.cos(
                    angle - Math.PI * 0.15
                ) * 0.25;

            const illumination =
                mainLight + secondaryLight;

            const baseLightness = clamp(
                44 + illumination * 12,
                25,
                62
            );

            const wall =
                document.createElement("div");

            wall.className =
                "coin-wall-segment";

            Object.assign(wall.style, {
                position: "absolute",

                width: `${segmentWidth}px`,
                height: `${depth + 0.5}px`,

                left: "50%",
                top: "50%",

                marginLeft:
                    `${-segmentWidth / 2}px`,

                marginTop:
                    `${-(depth + 0.5) / 2}px`,

                transformOrigin:
                    "50% 50%",

                transformStyle:
                    "preserve-3d",

                transform: `
                    translate3d(
                        ${x}px,
                        ${y}px,
                        0
                    )
                    rotateZ(${degrees + 90}deg)
                    rotateX(90deg)
                `,

                background: `
                    linear-gradient(
                        180deg,

                        hsl(
                            52 100%
                            ${clamp(
                                baseLightness + 24,
                                45,
                                84
                            )}%
                        ) 0%,

                        hsl(
                            48 100%
                            ${clamp(
                                baseLightness + 12,
                                35,
                                76
                            )}%
                        ) 12%,

                        hsl(
                            42 100%
                            ${baseLightness}%
                        ) 28%,

                        hsl(
                            36 100%
                            ${clamp(
                                baseLightness - 13,
                                15,
                                52
                            )}%
                        ) 48%,

                        hsl(
                            44 100%
                            ${clamp(
                                baseLightness + 4,
                                25,
                                66
                            )}%
                        ) 68%,

                        hsl(
                            50 100%
                            ${clamp(
                                baseLightness + 18,
                                40,
                                80
                            )}%
                        ) 88%,

                        hsl(
                            37 100%
                            ${clamp(
                                baseLightness - 10,
                                16,
                                52
                            )}%
                        ) 100%
                    )
                `,

                boxShadow: `
                    inset 0.5px 0
                        rgba(255,245,130,.38),

                    inset -0.5px 0
                        rgba(116,60,0,.30)
                `,

                backfaceVisibility:
                    "visible",

                WebkitBackfaceVisibility:
                    "visible",

                pointerEvents: "none"
            });

            if (i % 3 === 0) {
                wall.style.borderLeft =
                    "0.5px solid rgba(255,245,120,.22)";
            } else if (i % 3 === 1) {
                wall.style.borderLeft =
                    "0.5px solid rgba(105,54,0,.18)";
            }

            container.appendChild(wall);
        }
    }

    /* =========================================================
       15. CREATE COMPLETE 3D COIN
       ========================================================= */

    function create3DCoin({
        parent,
        size,
        depth,
        position,
        side
    }) {
        const coin = document.createElement("div");

        coin.className =
            `coin-3d generated-coin ${side}-coin`;

        Object.assign(coin.style, {
            position: "absolute",

            width: `${size}px`,
            height: `${size}px`,

            transformStyle: "preserve-3d",

            pointerEvents: "none",
            overflow: "visible",

            zIndex: "50"
        });

        for (
            const [property, value]
            of Object.entries(position)
        ) {
            coin.style[property] =
                `${value}px`;
        }

        const geometry =
            document.createElement("div");

        geometry.className =
            "coin-geometry";

        Object.assign(geometry.style, {
            position: "absolute",
            inset: "0",

            width: "100%",
            height: "100%",

            transformStyle: "preserve-3d"
        });

        coin.appendChild(geometry);

        const frontFace =
            createCoinFace(
                size,
                depth,
                false
            );

        const backFace =
            createCoinFace(
                size,
                depth,
                true
            );

        geometry.appendChild(frontFace);
        geometry.appendChild(backFace);

        createCoinWall(
            geometry,
            size,
            depth,
            CONFIG.coin.segments
        );

        coin.style.transform =
            `translateZ(${CONFIG.coin.surfaceGap}px)`;

        parent.appendChild(coin);

        return coin;
    }

    /* =========================================================
       16. BUILD COINS
       ========================================================= */

    create3DCoin({
        parent: front,

        size: CONFIG.coin.frontSize,
        depth: CONFIG.coin.depth,

        position: {
            right: CONFIG.coin.frontRight,
            bottom: CONFIG.coin.frontBottom
        },

        side: "front"
    });

    create3DCoin({
        parent: back,

        size: CONFIG.coin.backSize,
        depth: CONFIG.coin.depth,

        position: {
            left: CONFIG.coin.backLeft,
            top: CONFIG.coin.backTop
        },

        side: "back"
    });

    /* =========================================================
       17. ROTATION STATE
       ========================================================= */

    let rotationX =
        CONFIG.initialRotationX;

    let rotationY =
        CONFIG.initialRotationY;

    let targetX = rotationX;
    let targetY = rotationY;

    let velocityX = 0;
    let velocityY = 0;

    let dragging = false;

    let previousX = 0;
    let previousY = 0;

    let activePointerId = null;

    /* =========================================================
       18. POINTER DOWN
       ========================================================= */

    function handlePointerDown(event) {
        // Ignore additional pointers.
        if (activePointerId !== null) {
            return;
        }

        // Mouse interaction should only begin with
        // the primary/left mouse button.
        if (
            event.pointerType === "mouse" &&
            event.button !== 0
        ) {
            return;
        }

        activePointerId = event.pointerId;
        dragging = true;

        previousX = event.clientX;
        previousY = event.clientY;

        velocityX = 0;
        velocityY = 0;

        try {
            stage.setPointerCapture(
                event.pointerId
            );
        } catch {
            // Pointer capture is optional.
        }

        stage.classList.add("is-dragging");
    }

    /* =========================================================
       19. POINTER MOVE
       ========================================================= */

    function handlePointerMove(event) {
        if (!dragging) {
            return;
        }

        if (
            event.pointerId !==
            activePointerId
        ) {
            return;
        }

        const dx =
            event.clientX - previousX;

        const dy =
            event.clientY - previousY;

        previousX = event.clientX;
        previousY = event.clientY;

        const deltaY =
            dx * CONFIG.dragSensitivity;

        const deltaX =
            -dy * CONFIG.dragSensitivity;

        targetY += deltaY;
        targetX += deltaX;

        targetX = clamp(
            targetX,
            -CONFIG.maxRotationX,
            CONFIG.maxRotationX
        );

        velocityY = deltaY;
        velocityX = deltaX;
    }

    /* =========================================================
       20. END POINTER INTERACTION
       ========================================================= */

    function finishPointerInteraction(
        pointerId = activePointerId
    ) {
        if (activePointerId === null) {
            return;
        }

        if (
            pointerId !== null &&
            pointerId !== activePointerId
        ) {
            return;
        }

        const capturedPointer =
            activePointerId;

        dragging = false;
        activePointerId = null;

        try {
            if (
                capturedPointer !== null &&
                stage.hasPointerCapture?.(
                    capturedPointer
                )
            ) {
                stage.releasePointerCapture(
                    capturedPointer
                );
            }
        } catch {
            // Capture may already have been lost.
        }

        stage.classList.remove(
            "is-dragging"
        );
    }

    function handlePointerUp(event) {
        finishPointerInteraction(
            event.pointerId
        );
    }

    function handleLostPointerCapture(event) {
        if (
            event.pointerId ===
            activePointerId
        ) {
            dragging = false;
            activePointerId = null;

            stage.classList.remove(
                "is-dragging"
            );
        }
    }

    /* =========================================================
       21. POINTER EVENTS
       ========================================================= */

    stage.addEventListener(
        "pointerdown",
        handlePointerDown
    );

    stage.addEventListener(
        "pointermove",
        handlePointerMove
    );

    stage.addEventListener(
        "pointerup",
        handlePointerUp
    );

    stage.addEventListener(
        "pointercancel",
        handlePointerUp
    );

    stage.addEventListener(
        "lostpointercapture",
        handleLostPointerCapture
    );

    /* =========================================================
       22. PREVENT NATIVE IMAGE DRAGGING
       ========================================================= */

    card
        .querySelectorAll("img")
        .forEach((image) => {
            image.draggable = false;

            image.addEventListener(
                "dragstart",
                (event) => {
                    event.preventDefault();
                }
            );
        });

    /* =========================================================
       23. ANIMATION / MOMENTUM
       ========================================================= */

    let animationFrameId = 0;

    function animate() {
        if (!dragging) {
            targetY += velocityY;
            targetX += velocityX;

            velocityX *= CONFIG.momentum;
            velocityY *= CONFIG.momentum;

            targetX = clamp(
                targetX,
                -CONFIG.maxRotationX,
                CONFIG.maxRotationX
            );

            // Stop microscopic movement.
            if (
                Math.abs(velocityX) < 0.001
            ) {
                velocityX = 0;
            }

            if (
                Math.abs(velocityY) < 0.001
            ) {
                velocityY = 0;
            }
        }

        rotationX +=
            (targetX - rotationX) *
            CONFIG.smoothing;

        rotationY +=
            (targetY - rotationY) *
            CONFIG.smoothing;

        card.style.transform =
            `rotateX(${rotationX}deg) ` +
            `rotateY(${rotationY}deg)`;

        animationFrameId =
            requestAnimationFrame(animate);
    }

    animationFrameId =
        requestAnimationFrame(animate);

    /* =========================================================
       24. DOUBLE CLICK = FRONT VIEW
       ========================================================= */

    function resetToFront() {
        targetX = 0;
        targetY = 0;

        velocityX = 0;
        velocityY = 0;
    }

    stage.addEventListener(
        "dblclick",
        resetToFront
    );

    /* =========================================================
       25. PUBLIC API
       ========================================================= */

    const api = {
        rotateTo(x, y) {
            const nextX =
                isFiniteNumber(x)
                    ? Number(x)
                    : 0;

            const nextY =
                isFiniteNumber(y)
                    ? Number(y)
                    : 0;

            targetX = clamp(
                nextX,
                -CONFIG.maxRotationX,
                CONFIG.maxRotationX
            );

            targetY = nextY;

            velocityX = 0;
            velocityY = 0;

            return api;
        },

        showFront() {
            return api.rotateTo(0, 0);
        },

        showBack() {
            return api.rotateTo(0, 180);
        },

        showLeftEdge() {
            return api.rotateTo(0, 90);
        },

        showRightEdge() {
            return api.rotateTo(0, -90);
        },

        rebuild() {
            buildShell();
            return api;
        },

        reset() {
            targetX =
                CONFIG.initialRotationX;

            targetY =
                CONFIG.initialRotationY;

            velocityX = 0;
            velocityY = 0;

            return api;
        },

        getRotation() {
            return {
                x: rotationX,
                y: rotationY,
                targetX,
                targetY
            };
        },

        destroy() {
            cancelAnimationFrame(
                animationFrameId
            );

            finishPointerInteraction();

            stage.removeEventListener(
                "pointerdown",
                handlePointerDown
            );

            stage.removeEventListener(
                "pointermove",
                handlePointerMove
            );

            stage.removeEventListener(
                "pointerup",
                handlePointerUp
            );

            stage.removeEventListener(
                "pointercancel",
                handlePointerUp
            );

            stage.removeEventListener(
                "lostpointercapture",
                handleLostPointerCapture
            );

            stage.removeEventListener(
                "dblclick",
                resetToFront
            );

            shell.remove();

            front
                .querySelectorAll(
                    ".generated-coin"
                )
                .forEach(
                    (coin) => coin.remove()
                );

            back
                .querySelectorAll(
                    ".generated-coin"
                )
                .forEach(
                    (coin) => coin.remove()
                );

            if (
                window.JokesterCard3D === api
            ) {
                delete window.JokesterCard3D;
            }
        }
    };

    window.JokesterCard3D = api;
})();
