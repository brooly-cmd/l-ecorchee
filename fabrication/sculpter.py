# L'Écorchée : mygale à genoux rouges (Brachypelma hamorii) sculptée par script.
# Lancer : blender --background --python sculpter.py   (RENDU=hero,dessus,organes pour les aperçus)
# Repère : X latéral (+ = gauche de l'araignée), Y longitudinal (-Y = avant), Z haut. 1 unité ≈ 2,3 cm.
import bpy, json, math, os, struct
import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))
SORTIE = os.path.normpath(os.path.join(ICI, "..", "assets"))
os.makedirs(SORTIE, exist_ok=True)
rng = np.random.default_rng(11)
Z0 = 0.72


# ---------- outils ----------
def lin(h):
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)])
    return np.where(c < .04045, c / 12.92, ((c + .055) / 1.055) ** 2.4)


def unit(v):
    return v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-9)


_ondes = rng.normal(size=(64, 3))
_phases = rng.uniform(0, 6.28, 64)


def bruit(p, f=4.0, oct=6):
    p = np.asarray(p)
    s = 0
    for i in range(oct):
        k = _ondes[(i * 7) % 64:(i * 7) % 64 + 6] * f * 1.9 ** i
        s = s + np.sin(p @ k.T + _phases[i:i + 6]).mean(-1) / 1.7 ** i
    return s


def normales(V, F):
    n = np.zeros_like(V)
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    for i in range(3):
        np.add.at(n, F[:, i], fn)
    return unit(n)


def grille(P, uvx=2.0, uvy=2.0):
    """P (anneaux, nu, 3) : surface fermée en u, bouchée aux deux bouts. Coins UV séparés au raccord."""
    nv, nu, _ = P.shape
    V = np.vstack([P.reshape(-1, 3), P[0].mean(0)[None], P[-1].mean(0)[None]])
    a, b = nv * nu, nv * nu + 1
    F, U = [], []
    for j in range(nv - 1):
        for i in range(nu):
            i2 = (i + 1) % nu
            q = [j * nu + i, j * nu + i2, (j + 1) * nu + i2, (j + 1) * nu + i]
            uq = [(i / nu * uvx, j / nv * uvy), ((i + 1) / nu * uvx, j / nv * uvy),
                  ((i + 1) / nu * uvx, (j + 1) / nv * uvy), (i / nu * uvx, (j + 1) / nv * uvy)]
            F += [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]
            U += [[uq[0], uq[1], uq[2]], [uq[0], uq[2], uq[3]]]
    for i in range(nu):
        i2 = (i + 1) % nu
        F += [[a, i2, i], [b, (nv - 1) * nu + i, (nv - 1) * nu + i2]]
        U += [[(0, 0)] * 3, [(0, 0)] * 3]
    F, U = np.array(F), np.array(U, float)
    # orientation vers l'extérieur
    c = V.mean(0)
    fc = V[F].mean(1)
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    if (fn * (fc - c)).sum() < 0:
        F, U = F[:, ::-1], U[:, ::-1]
    return V, F, U


def repere(path, haut=(0, 0, 1)):
    T = unit(np.gradient(path, axis=0))
    h = np.array(haut, float)
    N = np.zeros_like(T)
    n = unit(h - T[0] * (h @ T[0]) + 1e-4 * np.array([.3, .2, .1]))
    for i in range(len(path)):  # transport parallèle
        n = unit(n - T[i] * (n @ T[i]))
        N[i] = n
    return T, N, np.cross(T, N)


def loft(path, rx, rz=None, nu=14, dep=None, haut=(0, 0, 1), uvx=2, uvy=2):
    path = np.asarray(path, float)
    rx = np.broadcast_to(rx, (len(path),)).astype(float)
    rz = rx if rz is None else np.broadcast_to(rz, (len(path),)).astype(float)
    T, N, B = repere(path, haut)
    a = np.linspace(0, 2 * np.pi, nu, endpoint=False)[None, :]
    P = path[:, None] + (rx[:, None] * np.cos(a))[..., None] * B[:, None] + (rz[:, None] * np.sin(a))[..., None] * N[:, None]
    if dep is not None:
        P = dep(P)
    return grille(P, uvx, uvy)


def spline(pts, n=24):
    pts = np.asarray(pts, float)
    t = np.linspace(0, 1, len(pts))
    tt = np.linspace(0, 1, n)
    # Catmull-Rom
    p = np.vstack([2 * pts[0] - pts[1], pts, 2 * pts[-1] - pts[-2]])
    out = []
    for u in tt:
        s = u * (len(pts) - 1)
        i = min(int(s), len(pts) - 2)
        f = s - i
        p0, p1, p2, p3 = p[i], p[i + 1], p[i + 2], p[i + 3]
        out.append(.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (3 * p1 - p0 - 3 * p2 + p3) * f ** 3))
    return np.array(out)


def ellipsoide(c, r, nu=16, nv=12):
    a = np.linspace(.0001, np.pi - .0001, nv)
    b = np.linspace(0, 2 * np.pi, nu, endpoint=False)
    P = np.stack([np.sin(a)[:, None] * np.cos(b), np.sin(a)[:, None] * np.sin(b), np.cos(a)[:, None] * np.ones_like(b)], -1)
    return grille(P * np.asarray(r) + np.asarray(c))


def fusion(mailles):
    V, F, U, o = [], [], [], 0
    for m in mailles:
        V.append(m[0]); F.append(m[1] + o); U.append(m[2]); o += len(m[0])
    return np.vstack(V), np.vstack(F), np.vstack(U)


def uv_boite(V, F, k=3.0):
    return np.stack([(V[F, 0] + V[F, 2]) * k, (V[F, 1] + V[F, 2]) * k], -1)


def vers_blender(nom, V, F, U=None, C=None):
    me = bpy.data.meshes.new(nom)
    me.from_pydata(V.tolist(), [], F.tolist())
    me.update()
    me.shade_smooth()
    if U is not None:
        me.uv_layers.new(name="UV").uv.foreach_set("vector", U.reshape(-1))
    if C is not None:
        a = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        a.data.foreach_set("color", np.hstack([C, np.ones((len(C), 1))]).reshape(-1))
    ob = bpy.data.objects.new(nom, me)
    bpy.context.collection.objects.link(ob)
    return ob


def amas(boules, voxel=.03, lissage=8, garder=None):
    """Fond des ellipsoïdes/maillages en une masse fermée (remaillage voxel)."""
    V, F, U = fusion([b if isinstance(b, tuple) and len(b) == 3 and isinstance(b[0], np.ndarray) and b[0].ndim == 2
                      else ellipsoide(*b) for b in boules])
    ob = vers_blender("_tmp", V, F)
    m = ob.modifiers.new("r", "REMESH"); m.mode = "VOXEL"; m.voxel_size = voxel
    s = ob.modifiers.new("s", "SMOOTH"); s.factor = .7; s.iterations = lissage
    if garder:
        d = ob.modifiers.new("d", "DECIMATE"); d.ratio = 1.0
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    e = ob.evaluated_get(dg).to_mesh()
    e.calc_loop_triangles()
    V2 = np.zeros((len(e.vertices), 3)); e.vertices.foreach_get("co", V2.reshape(-1))
    F2 = np.zeros((len(e.loop_triangles), 3), int); e.loop_triangles.foreach_get("vertices", F2.reshape(-1))
    ob.to_mesh_clear()
    bpy.data.objects.remove(ob); bpy.data.meshes.remove(bpy.data.meshes["_tmp"])
    if garder and len(F2) > garder:
        ob = vers_blender("_tmp", V2, F2)
        d = ob.modifiers.new("d", "DECIMATE"); d.ratio = garder / len(F2)
        bpy.context.view_layer.update()
        e = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        e.calc_loop_triangles()
        V2 = np.zeros((len(e.vertices), 3)); e.vertices.foreach_get("co", V2.reshape(-1))
        F2 = np.zeros((len(e.loop_triangles), 3), int); e.loop_triangles.foreach_get("vertices", F2.reshape(-1))
        ob.to_mesh_clear()
        bpy.data.objects.remove(ob); bpy.data.meshes.remove(bpy.data.meshes["_tmp"])
    return V2, F2


# ---------- registre des parties ----------
PARTS, POILS = {}, {}


def partie(id, nom, terme, groupe, texte, V, F, U=None, C=None, mat="cuticule", nf=None, extra=None):
    if U is None:
        U = uv_boite(V, F)
    if C is None:
        C = np.ones((len(V), 3)) * .5
    PARTS[id] = dict(V=V, F=F, U=U, C=C, mat=mat, nom=nom, terme=terme, groupe=groupe, texte=texte, nf=nf or len(F), extra=extra or {})


def coque(V, F, U, C, ep, teinte="#c98f7c", nu=None):
    """Double la surface vers l'intérieur : mur fermé, indispensable au bouchage de coupe."""
    nr = (len(V) - 2) // nu
    A = V[:-2].reshape(nr, nu, 3)
    cen = A.mean(1)
    ray = np.linalg.norm(A - cen[:, None], axis=2).mean(1)
    k = np.clip(1 - ep / (ray + 1e-6), .05, 1)
    # les premiers et derniers anneaux reculent vers l'intérieur pour fermer le mur sans le percer
    j = np.arange(nr)
    rec = np.clip(j, 2, nr - 3)
    In = cen[rec][:, None] + (A - cen[:, None]) * (k[:, None, None] * np.where(np.abs(j - rec) > 0, .8, 1)[:, None, None])
    Vi = np.vstack([In.reshape(-1, 3), cen[2][None], cen[nr - 3][None]])
    Ci = np.ones_like(C) * lin(teinte) * (1 + .22 * bruit(V, 7, 4))[:, None]
    return np.vstack([V, Vi]), np.vstack([F, F[:, ::-1] + len(V)]), np.vstack([U, U[:, ::-1]]), np.vstack([C, Ci]), len(F)


# ---------- prosoma ----------
NOIR = lin("#17110f")


def prosoma():
    t = np.linspace(0, 1, 78)
    y = -1.02 + t * 1.3
    larg = .63 * np.sin(np.pi * t ** .86) ** .52 * (.72 + .28 * np.clip(t * 1.5, 0, 1))
    haut = .36 * np.sin(np.pi * t ** .8) ** .5 * (1.05 - .25 * t)
    bas = .17 * np.sin(np.pi * t ** .8) ** .55
    a = np.linspace(0, 2 * np.pi, 104, endpoint=False)
    s = np.sin(a)
    P = np.zeros((78, 104, 3))
    P[..., 0] = larg[:, None] * np.sign(np.cos(a)) * np.abs(np.cos(a)) ** .86
    P[..., 1] = y[:, None]
    P[..., 2] = Z0 + (np.where(s > 0, haut[:, None] * np.abs(s) ** .78, bas[:, None] * s))
    x, yy = P[..., 0], P[..., 1]
    dorsal = np.clip((P[..., 2] - Z0) / .1, 0, 1)
    # fovéa, stries rayonnantes, bosse céphalique, tubercule oculaire
    fy = -.2
    d = np.hypot(x, yy - fy)
    th = np.arctan2(yy - fy, x)
    P[..., 2] += dorsal * (-.075 * np.exp(-((x / .1) ** 2 + ((yy - fy) / .045) ** 2)) - .012 * np.exp(-(d - .32) ** 2 / .05) * (.5 + .5 * np.cos(th * 8)) ** 3)
    P[..., 2] += dorsal * (.065 * np.exp(-((x / .3) ** 2 + ((yy + .58) / .3) ** 2)))
    P[..., 2] += dorsal * (.055 * np.exp(-((x / .085) ** 2 + ((yy + .86) / .07) ** 2)))
    # lèvre du bord et légère irrégularité vivante
    bord = np.exp(-((P[..., 2] - Z0) / .025) ** 2)
    P[..., 0] += bord * np.sign(x) * .012
    P += (bruit(P.reshape(-1, 3), 9, 4).reshape(P.shape[:2]) * .004)[..., None] * [1, 1, 1]
    V, F, U = grille(P, 8, 6)
    marge = np.clip(1 - (V[:, 2] - Z0) / .09, 0, 1) * (V[:, 2] > Z0 - .01)
    C = NOIR * (1 + .3 * bruit(V, 12, 3))[:, None] * (1 - marge[:, None]) + lin("#8a4a22") * marge[:, None]
    V, F, U, C, nf = coque(V, F, U, C, .017, nu=104)
    partie("carapace", "Carapace", "Prosoma, bouclier dorsal", "exosquelette",
           "Le bouclier de la tête et du thorax. La fossette au centre, la fovéa, ancre le muscle qui actionne l'estomac.", V, F, U, C, nf=nf)
    # sternum : plaque ventrale
    t = np.linspace(0, 1, 22)
    a = np.linspace(0, 2 * np.pi, 40, endpoint=False)
    Pp = np.zeros((22, 40, 3))
    lx = .36 * np.sin(np.pi * t) ** .6
    Pp[..., 0] = lx[:, None] * np.cos(a); Pp[..., 1] = (-.62 + t * .78)[:, None]
    Pp[..., 2] = Z0 - .185 + .022 * np.sin(a)[None] * np.sin(np.pi * t)[:, None] ** .5
    V, F, U = grille(Pp, 3, 3)
    C = NOIR * (1.3 + .3 * bruit(V, 14, 3))[:, None]
    partie("sternum", "Sternum", "Plaque ventrale", "exosquelette", "La plaque du ventre, entre les hanches des huit pattes. C'est le plancher du corps.", V, F, U, C)
    # labium & maxilles
    V, F, U = ellipsoide((0, -.67, Z0 - .17), (.075, .08, .028), 22, 14)
    partie("labium", "Labium", "Lèvre inférieure", "bouche", "La lèvre basse, juste sous la bouche. Elle retient le liquide de la proie, qui remonte ensuite vers le pharynx.", V, F, U, np.ones((len(V), 3)) * lin("#2c1913"))
    Vs = []
    for s in (-1, 1):
        Vs.append(loft(spline([(s * .10, -.52, Z0 - .18), (s * .17, -.70, Z0 - .17), (s * .13, -.86, Z0 - .15)], 14), .058 * np.sin(np.linspace(.35, 2.85, 14)) ** .6, .035, 14))
    V, F, U = fusion(Vs)
    partie("maxilles", "Maxilles", "Pièces buccales", "bouche", "Deux lames bordées de soies. Elles filtrent la bouillie de proie : seuls les liquides passent dans la bouche.", V, F, U, np.ones((len(V), 3)) * lin("#241511"))
    # yeux : huit dômes de verre noir sur le tubercule
    ye = [(.055, -.905, .1), (-.055, -.905, .1), (.024, -.88, .135), (-.024, -.88, .135), (.075, -.855, .118), (-.075, -.855, .118), (.04, -.835, .138), (-.04, -.835, .138)]
    mailles = []
    for (x, y, z), rr in zip(ye, (.021, .021, .017, .017, .018, .018, .014, .014)):
        mailles.append(ellipsoide((x, y, Z0 + .39 - .135 + z - .1 + .03), (rr, rr, rr * .8), 18, 12))
    V, F, U = fusion(mailles)
    partie("yeux", "Huit yeux", "Ocelles", "tete", "Huit petits yeux simples, serrés sur une butte. Elle distingue surtout l'ombre et la lumière : son vrai sens, c'est le toucher.", V, F, U, np.ones((len(V), 3)) * lin("#050506"), mat="oeil")
    return


# ---------- pattes ----------
SEG = [
    ("coxa", "Coxa", "La hanche. Elle pivote dans le corps et abrite les muscles les plus puissants de la patte."),
    ("trochanter", "Trochanter", "Un petit anneau articulé, la charnière entre la hanche et la cuisse."),
    ("femur", "Fémur", "La cuisse, le plus long segment. Sans muscle extenseur au genou, c'est la pression du sang qui déplie la patte."),
    ("patelle", "Patelle", "Le fameux genou orange de cette mygale. Une articulation purement hydraulique, comme un petit vérin."),
    ("tibia", "Tibia", "Couvert de soies sensorielles, les trichobothries. Elles captent le moindre souffle d'air."),
    ("metatarse", "Métatarse", "L'avant-dernier segment. Ses organes en fente mesurent la tension du squelette : elle sent les vibrations du sol."),
    ("tarse", "Tarse", "Le pied. Une brosse de soies, la scopula, et deux griffes lui permettent de grimper sur du verre."),
]
ARTICLES = {1: "première", 2: "deuxième", 3: "troisième", 4: "quatrième"}


def dirv(s, az, el):
    az, el = math.radians(az), math.radians(el)
    return np.array([s * math.cos(az) * math.cos(el), -math.sin(az) * math.cos(el), math.sin(el)])


def chaine(base, s, az, daz, longs, els, d):
    j = [np.array(base)]
    for i, (L, e) in enumerate(zip(longs, els)):
        de = d * (1.0 if i >= 4 else (.0 if i < 2 else (.35 if i == 3 else -.35)))
        j.append(j[-1] + dirv(s, az + daz * i, e + de) * L)
    return j


def segment(a, b, r0, r1, nu=14, bulbe=.12, cote=0.0, rings=18):
    t = np.linspace(-.04, 1.04, rings)
    path = a[None] + (b - a)[None] * t[:, None]
    path = path + np.array([0, 0, 1.])[None] * (np.sin(np.pi * np.clip(t, 0, 1)) * cote)[:, None]
    env = np.clip(np.sin(np.pi * np.clip((t + .04) / 1.08, 0, 1)), 0, 1) ** .22
    r = (r0 + (r1 - r0) * t) * (1 + bulbe * np.sin(np.pi * np.clip(t, 0, 1))) * env
    # bourrelets articulaires
    r = r * (1 + .08 * np.exp(-((t - .02) / .05) ** 2) + .1 * np.exp(-((t - .97) / .045) ** 2))
    return path, r


def patte(idx, s, base, az, daz, mult, els):
    L = np.array([.30, .15, 1.14, .50, .84, .86, .56]) * np.array([1, 1, mult, mult, mult, mult, mult])
    R = [(.135, .120), (.115, .108), (.112, .096), (.100, .094), (.094, .076), (.070, .056), (.058, .048)]
    lo, hi = -40, 40
    for _ in range(40):
        d = (lo + hi) / 2
        j = chaine(base, s, az, daz, L, els, d)
        if j[-1][2] > .035:
            lo, hi = lo, d
        else:
            lo, hi = d, hi
    j = chaine(base, s, az, daz, L, els, d)
    cote = "gauche" if s > 0 else "droite"
    code = f"{'G' if s > 0 else 'D'}{idx}"
    chemin_muscle = []
    for i, (cle, nom, txt) in enumerate(SEG):
        path, r = segment(j[i], j[i + 1], *R[i], cote=.018 if i in (2, 4) else 0)
        V, F, U = loft(path, r, r * (.94 if i != 2 else .9), nu=18 if i >= 2 else 20, uvx=2, uvy=max(2, L[i] * 3))
        ton = {"patelle": "#301911", "tibia": "#21140f"}.get(cle, "#150f0e")
        C = lin(ton) * (1 + .25 * bruit(V, 16, 3))[:, None]
        if cle == "tarse":  # griffes
            T = unit(j[-1] - j[-2])
            lat = unit(np.cross(T, [0, 0, 1]))
            gr = []
            for sg in (-1, 1):
                p0 = j[-1] + lat * sg * .02
                g = spline([p0 - T * .02, p0 + T * .045 + np.array([0, 0, .012]), p0 + T * .085 - np.array([0, 0, .014]), p0 + T * .10 - np.array([0, 0, .05])], 12)
                gr.append(loft(g, np.linspace(.019, .0012, 12), nu=9))
            Vg, Fg, Ug = fusion(gr)
            Cg = np.ones((len(Vg), 3)) * lin("#0a0605")
            # griffes indépendantes de la coque
        Vc, Fc, Uc, Cc, nf = coque(V, F, U, C, .008, nu=18 if i >= 2 else 20)
        if cle == "tarse":
            nb = len(Vc)
            Vc = np.vstack([Vc, Vg]); Fc = np.vstack([Fc, Fg + nb]); Uc = np.vstack([Uc, Ug]); Cc = np.vstack([Cc, Cg])
        partie(f"{cle}_{code}", f"{nom}, patte {idx} {cote}", nom, f"patte{idx}", txt, Vc, Fc, Uc, Cc, nf=nf,
               extra=dict(patte=code, segment=cle, tangente=(j[i + 1] - j[i]).tolist(), mur=(len(V), 2 * len(V))))
        chemin_muscle.append(path[2:-2])
    # muscle intérieur : un cordon rouge continu dans toute la patte
    pm = np.vstack(chemin_muscle)
    pm = pm[::2]
    rm = np.interp(np.linspace(0, 1, len(pm)), [0, .15, .45, .7, 1], [.052, .044, .044, .027, .014])
    rm = rm * (1 + .16 * np.sin(np.linspace(0, 34, len(pm))))
    T_, N_, B_ = repere(pm)
    fx = []
    for q in range(3):
        ph = q * 2.094 + np.linspace(0, 7, len(pm))
        fx.append(loft(pm + (N_ * np.cos(ph)[:, None] + B_ * np.sin(ph)[:, None]) * rm[:, None] * .52, rm * .56, nu=8, uvy=8))
    V, F, U = fusion(fx)
    C = lin("#9b3a30") * (.85 + .3 * bruit(V, 40, 3))[:, None]
    partie(f"muscle_{code}", f"Muscles, patte {idx} {cote}", "Muscles fléchisseurs", "muscles",
           "Ces muscles replient la patte. Pour la déplier, l'araignée pousse son sang dedans. À sa mort, les pattes se recroquevillent : la pression a disparu.", V, F, U, C, mat="muscle")
    return j


JOINTS = {}


def pattes():
    cfg = [
        (1, -.60, 62, 3, 1.05, [-6, 16, 46, 6, -24, -46, -20]),
        (2, -.31, 26, 2, .97, [-6, 16, 50, 6, -28, -50, -22]),
        (3, -.03, -14, -3, .86, [-6, 16, 54, 8, -30, -54, -24]),
        (4, .19, -48, -3, 1.13, [-6, 14, 44, 6, -22, -44, -18]),
    ]
    for s in (1, -1):
        for idx, y, az, daz, mult, els in cfg:
            base = (s * .30, y, Z0 - .13)
            JOINTS[(idx, s)] = patte(idx, s, base, az, daz, mult, els)


def palpes():
    longs = [.2, .12, .62, .30, .42, .26]
    for s in (1, -1):
        j = [np.array((s * .19, -.74, Z0 - .13))]
        for L, (az, el) in zip(longs, [(75, -10), (80, 15), (70, 42), (82, -5), (88, -42), (90, -34)]):
            j.append(j[-1] + dirv(s, az, el) * L)
        cote = "gauche" if s > 0 else "droit"
        code = "G" if s > 0 else "D"
        mailles, muscle = [], []
        for i in range(6):
            r0 = [.08, .07, .07, .066, .06, .052][i]
            path, r = segment(j[i], j[i + 1], r0, r0 * .88, rings=14)
            mailles.append(loft(path, r, nu=16))
            muscle.append(path[2:-2])
        # mur par segment : peau d'abord, puis parois internes, pour que les poils restent dehors
        ext = fusion(mailles)
        C = lin("#160f0d") * (1 + .25 * bruit(ext[0], 16, 3))[:, None]
        nf = len(ext[1])
        Vs, Fs, Us, Cs, o = [ext[0]], [ext[1]], [ext[2]], [C], len(ext[0])
        for mm in mailles:
            Cm = np.ones((len(mm[0]), 3)) * lin("#160f0d")
            vv, ff, uu, cc, n1 = coque(mm[0], mm[1], mm[2], Cm, .007, nu=16)
            nv_ = len(mm[0])
            Vs.append(vv[nv_:]); Fs.append(ff[n1:] - nv_ + o); Us.append(uu[n1:]); Cs.append(cc[nv_:]); o += nv_
        V, F, U, C = np.vstack(Vs), np.vstack(Fs), np.vstack(Us), np.vstack(Cs)
        partie(f"palpe_{code}", f"Pédipalpe {cote}", "Pédipalpe", "tete",
               "Comme une paire de mains près de la bouche. Elle tâte, goûte et maintient la proie.", V, F, U, C, nf=nf,
               extra=dict(chemin=np.vstack(muscle).tolist()))


def chelicere():
    for s in (1, -1):
        code = "G" if s > 0 else "D"
        cote = "gauche" if s > 0 else "droite"
        path = spline([(s * .135, -.72, Z0 + .15), (s * .15, -.92, Z0 + .12), (s * .14, -1.12, Z0 + .02), (s * .13, -1.22, Z0 - .13)], 34)
        t = np.linspace(0, 1, 34)
        r = np.sin(np.pi * np.clip(t * .94 + .03, 0, 1)) ** .4 * (.155 + .05 * np.sin(np.pi * t))
        V, F, U = loft(path, r, r * 1.08, nu=42, uvx=3, uvy=3)
        C = lin("#120d0c") * (1 + .2 * bruit(V, 14, 3))[:, None]
        V, F, U, C, nf = coque(V, F, U, C, .011, nu=42)
        partie(f"chelicere_{code}", f"Chélicère {cote}", "Chélicère", "tete",
               "La base du crochet, un bloc musculeux. Chez la mygale, elle se lève et frappe vers le bas, comme une pioche.", V, F, U, C, nf=nf)
        c = spline([(s * .13, -1.22, Z0 - .12), (s * .125, -1.19, Z0 - .24), (s * .12, -1.09, Z0 - .34), (s * .115, -.96, Z0 - .36)], 24)
        tt = np.linspace(0, 1, 24)
        Vc, Fc, Uc = loft(c, .058 * (1 - tt) ** .8 + .0004, nu=18)
        Cc = np.ones((len(Vc), 3)) * lin("#120705")
        partie(f"crochet_{code}", f"Crochet {cote}", "Crochet à venin", "tete",
               "Une griffe creuse, longue d'un centimètre. Elle injecte le venin par un petit trou près de la pointe.", Vc, Fc, Uc, Cc, mat="griffe")
        # glande à venin : sac rayé logé DANS la chélicère (particularité des mygales)
        pg = spline([(s * .135, -.78, Z0 + .13), (s * .145, -.94, Z0 + .10), (s * .14, -1.06, Z0 + .04)], 24)
        rg = np.sin(np.linspace(.15, 3, 24)) ** .6 * .068
        Vg, Fg, Ug = loft(pg, rg, nu=22)
        k = Vg[:, 1] * 60 + np.arctan2(Vg[:, 2] - Z0, Vg[:, 0]) * 4
        Cg = lin("#c9b26e")[None] * .7 + (lin("#70513a") * .5)[None] * (np.sin(k)[:, None] * .5 + .5)
        conduit = loft(spline([(s * .14, -1.06, Z0 + .03), (s * .135, -1.18, Z0 - .05), (s * .13, -1.21, Z0 - .13)], 10), .012, nu=7)
        Vd, Fd, Ud = conduit
        V2 = np.vstack([Vg, Vd]); F2 = np.vstack([Fg, Fd + len(Vg)]); U2 = np.vstack([Ug, Ud])
        C2 = np.vstack([Cg, np.ones((len(Vd), 3)) * lin("#c9b26e")])
        partie(f"venin_{code}", f"Glande à venin {cote}", "Glande à venin", "tete",
               "Un sac spiralé de muscles. En se contractant, il chasse le venin vers le crochet. Chez les mygales il tient dans la chélicère.", V2, F2, U2, C2, mat="organe")


# ---------- opisthosoma ----------
def abdomen():
    t = np.linspace(0, 1, 92)
    y = .28 + t * 1.78
    env = np.sin(np.pi * t ** .86) ** .58
    larg = .78 * env * (1 - .12 * t)
    hautz = .70 * env
    a = np.linspace(0, 2 * np.pi, 116, endpoint=False)
    P = np.zeros((92, 116, 3))
    P[..., 0] = larg[:, None] * np.cos(a)
    P[..., 1] = y[:, None]
    P[..., 2] = Z0 + .08 + hautz[:, None] * np.sin(a) * (1 - .1 * (np.sin(a) < 0))
    P[..., 2] += .06 * np.exp(-((y[:, None] - .85) / .55) ** 2) * (np.sin(a) > 0) * np.sin(a)
    P += (bruit(P.reshape(-1, 3), 6, 4).reshape(P.shape[:2]) * .006)[..., None]
    V, F, U = grille(P, 8, 6)
    C = lin("#100c0b") * (1 + .25 * bruit(V, 12, 3))[:, None]
    V, F, U, C, nf = coque(V, F, U, C, .012, "#b98b7d", nu=116)
    partie("abdomen", "Abdomen", "Opisthosoma", "exosquelette",
           "Une poche souple et poilue. La mygale peut lancer ses poils urticants en les frottant avec ses pattes arrière.", V, F, U, C, nf=nf)
    # pédicelle
    p = spline([(0, .16, Z0 + .03), (0, .3, Z0 + .03), (0, .46, Z0 + .07)], 22)
    V, F, U = loft(p, .112 * (1 - .28 * np.sin(np.linspace(0, np.pi, 22))), nu=24)
    V, F, U, C, nf = coque(V, F, U, np.ones((len(V), 3)) * lin("#1a100c"), .008, nu=24)
    partie("pedicelle", "Pédicelle", "Taille", "exosquelette",
           "La taille fine qui relie les deux moitiés. L'aorte, l'intestin et un nerf y passent, serrés comme des câbles.", V, F, U, C, nf=nf)
    # filières
    mailles = []
    for s in (1, -1):
        mailles.append(loft(spline([(s * .09, 1.98, Z0 - .02), (s * .15, 2.14, Z0 - .05), (s * .17, 2.30, Z0 - .02)], 18), np.linspace(.052, .012, 18), nu=14))
        mailles.append(loft(spline([(s * .055, 1.96, Z0 - .10), (s * .07, 2.04, Z0 - .13)], 10), np.linspace(.03, .012, 10), nu=12))
    V, F, U = fusion(mailles)
    C = lin("#1d120e") * (1 + .2 * bruit(V, 15, 3))[:, None]
    partie("filieres", "Filières", "Filières", "exosquelette",
           "Quatre petits doigts mobiles, au bout de l'abdomen. La soie en sort liquide puis durcit en s'étirant.", V, F, U, C)


# ---------- organes ----------
def cz(*p):
    return (p[0], p[1], Z0 + p[2])


def dedans(pp, marge=.86):
    """Ramène un tube dans l'abdomen : aucun organe ne doit percer la peau."""
    pp = np.array(pp, float)
    pp[:, 1] = np.clip(pp[:, 1], .4, 1.97)
    t = np.clip((pp[:, 1] - .28) / 1.78, .001, .999)
    env = np.sin(np.pi * t ** .86) ** .58
    ax, az = .78 * env * (1 - .12 * t) * marge, .66 * env * marge
    dx, dz = pp[:, 0] / ax, (pp[:, 2] - Z0 - .08) / az
    k = np.maximum(1, np.hypot(dx, dz))
    pp[:, 0] /= k
    pp[:, 2] = Z0 + .08 + (pp[:, 2] - Z0 - .08) / k
    return pp


def organes():
    # estomac suceur : sac en croix, sous la fovéa
    b = [(cz(0, -.2, .08), (.14, .16, .1))]
    for x, y in ((.15, 0), (-.15, 0), (0, .17), (0, -.17)):
        b.append((cz(x, -.2 + y, .07), (.09 + abs(x) * .3, .08 + abs(y) * .3, .07)))
    V, F = amas(b, .007, 6)
    C = lin("#d9836f") * (1 + .18 * bruit(V, 22, 3))[:, None]
    partie("estomac", "Estomac suceur", "Estomac pompant", "digestion",
           "Une vraie pompe. Elle n'a pas de mâchoire : elle liquéfie sa proie avec ses sucs et l'aspire, lentement.", V, F, None, C, mat="organe")
    # muscles dilatateurs + rayonnants
    m = []
    for x, y, h in ((.0, -.2, .29), (.09, -.2, .27), (-.09, -.2, .27), (.0, -.09, .28), (.0, -.32, .28)):
        p = spline([cz(x * .6, y, .14), cz(x, y, h)], 8)
        m.append(loft(p, .026 * (1 - .4 * np.sin(np.linspace(0, 3.14, 8))), nu=10))
    a_ = np.array([.32, -.3, -.02, .18])
    for s in (1, -1):
        for yb in a_:
            for k in range(3):
                de = k * .03 - .03
                p = spline([cz(s * .06, -.2 + de, -.06), cz(s * .2, (yb + -.2) / 2 + de, -.05), cz(s * .36, yb + de, -.08)], 10)
                m.append(loft(p, .022 * (1 - .4 * np.sin(np.linspace(0, 3.14, 10))) + .004, nu=8))
    V, F, U = fusion(m)
    C = lin("#a93f35") * (1 + .18 * np.sin(V[:, 0] * 90 + V[:, 2] * 70))[:, None]
    partie("muscles_thorax", "Muscles du thorax", "Muscles coxaux", "muscles", "Des faisceaux qui relient le plancher du corps aux hanches. Ils font pivoter chaque patte depuis le centre du corps.", V, F, U, C, mat="muscle")
    # cerveau et masse nerveuse
    b = [(cz(0, -.48, -.03), (.13, .17, .085)), (cz(0, -.25, -.10), (.17, .32, .065)), (cz(0, -.72, .03), (.085, .1, .06))]
    for s in (1, -1):
        for y in (-.52, -.34, -.18, -.02):
            b.append((cz(s * .13, y, -.1), (.055, .05, .04)))
    V, F = amas(b, .007, 8)
    C = lin("#e6d6b6") * (1 + .08 * bruit(V, 30, 3))[:, None]
    partie("cerveau", "Cerveau", "Masse nerveuse centrale", "nerfs",
           "Tout le système nerveux est concentré ici, en un seul bloc. Chez les petites araignées, il déborde jusque dans les pattes.", V, F, None, C, mat="nerf")
    # nerfs vers les pattes, les yeux et l'abdomen
    n = []
    for (idx, s), j in JOINTS.items():
        y0 = [-.52, -.34, -.18, -.02][idx - 1]
        p = spline([cz(s * .13, y0, -.10), j[1], j[2], j[3], j[4], j[5], j[6]], 40)
        n.append(loft(p, np.linspace(.016, .005, 40), nu=6))
    n.append(loft(spline([cz(0, .05, -.10), cz(0, .3, -.02), cz(0, .7, -.12), cz(.02, 1.1, -.25)], 26), np.linspace(.016, .006, 26), nu=6))
    for s in (1, -1):
        for dx, ey in ((.02, -.85), (.05, -.82)):
            n.append(loft(spline([cz(s * .03, -.72, .07), cz(s * dx, -.8, .18), cz(s * dx, ey, .24)], 10), .006, nu=6))
    V, F, U = fusion(n)
    C = np.ones((len(V), 3)) * lin("#f3e6c9")
    partie("nerfs", "Nerfs", "Nerfs des pattes", "nerfs", "Un câble part vers chaque patte, jusqu'au bout des griffes. Le système complet tient dans la longueur d'un doigt.", V, F, U, C, mat="nerf")
    # caecums du prosoma
    d = []
    for s in (1, -1):
        for yt in (-.62, -.34, -.08, .12):
            p = spline([cz(s * .10, -.2, .03), cz(s * .30, (yt - .2) / 2, .06), cz(s * .47, yt, .03)], 14)
            pp = p[np.linspace(0, 13, 9).astype(int)]
            for q, rr in zip(pp, np.linspace(.03, .05, 9)):
                d.append((tuple(q), (rr, rr, rr * .8)))
    V, F = amas(d, .009, 6, garder=16000)
    C = lin("#86723f") * (1 + .22 * bruit(V, 18, 3))[:, None]
    partie("caecums", "Caecums digestifs", "Diverticules du prosoma", "digestion", "Des culs-de-sac qui s'enfoncent jusqu'aux hanches des pattes. Ils stockent le repas et l'absorbent lentement.", V, F, None, C, mat="organe")
    # tube digestif
    p = spline([cz(0, -.78, -.12), cz(0, -.62, .0), cz(0, -.42, .08), cz(0, -.25, .09), cz(0, -.02, .03), cz(0, .16, .02), cz(0, .3, .02), cz(0, .55, .06), cz(0, .95, .05), cz(0, 1.45, -.02), cz(0, 1.8, -.06), cz(0, 2.0, -.08)], 90)
    r = np.interp(np.linspace(0, 1, 90), [0, .2, .3, .55, .85, 1], [.024, .026, .02, .02, .03, .018])
    V, F, U = loft(p, r, nu=10, uvy=10)
    partie("intestin", "Tube digestif", "Œsophage et intestin", "digestion", "De la bouche à l'anus, un fin tube traverse la taille. Elle ne peut avaler que du liquide.", V, F, U, np.ones((len(V), 3)) * lin("#b5825a"), mat="organe")
    # poche stercorale
    V, F = amas([(cz(0, 1.68, -.05), (.11, .17, .1)), (cz(.05, 1.58, -.03), (.07, .09, .07))], .012, 6)
    partie("stercorale", "Poche stercorale", "Poche à déchets", "digestion", "Une réserve à déchets juste avant l'anus. Elle peut y garder ses excréments pendant des semaines.", V, F, None, np.ones((len(V), 3)) * lin("#6a4a2a"), mat="organe")
    # diverticules de l'abdomen : masse lobée, laissant un couloir dorsal au coeur
    b = []
    for i in range(1100):
        while True:
            y = rng.uniform(.5, 1.75)
            ang = rng.uniform(0, 6.28)
            rr = rng.uniform(.3, .72) * math.sin(math.pi * (y - .28) / 1.78) ** .55
            x, z = rr * math.cos(ang), rr * math.sin(ang)
            z *= .86
            z += .08
            if (abs(x) > .13 or z < -.05) and not (abs(x) < .24 and z > .42):
                break
        if z < -.08 and y < 1.1 and abs(x) > .18:  # place des poumons
            continue
        if z < -.26 and y >= 1.1:  # place des glandes
            continue
        r0 = rng.uniform(.028, .062)
        b.append(((x, y, Z0 + z), (r0 * rng.uniform(.8, 1.2), r0 * rng.uniform(1.2, 1.8), r0 * rng.uniform(.8, 1.2))))
    V, F = amas(b, .009, 3, garder=48000)
    m_ = np.clip(.5 + .9 * bruit(V, 9, 5), 0, 1)[:, None]
    C = lin("#a97f3c") * m_ + lin("#5d3f1e") * (1 - m_)
    partie("diverticules", "Diverticules de l'intestin", "Intestin moyen", "digestion", "La plus grande partie de l'abdomen. Grâce à ces réserves, une mygale peut jeûner plusieurs mois.", V, F, None, C, mat="organe")
    # coeur + aorte (bleu : hémolymphe à hémocyanine)
    p = spline([cz(0, .52, .50), cz(0, .78, .59), cz(0, 1.1, .62), cz(0, 1.42, .56), cz(0, 1.66, .42)], 56)
    t = np.linspace(0, 1, 56)
    r = np.sin(np.pi * t) ** .45 * (.058 + .012 * np.sin(t * 25.1))
    Vh, Fh, Uh = loft(p, r, nu=20, uvy=4)
    C = lin("#315d9b") * (1 + .28 * np.sin(Vh[:, 1] * 80))[:, None]
    for yo in (.82, 1.08, 1.34):
        ost = np.exp(-(((Vh[:, 1] - yo) / .022) ** 2 + ((np.abs(Vh[:, 0]) - .05) / .016) ** 2))
        C = C * (1 - .85 * ost[:, None])
    lig = []
    for yy in np.linspace(.68, 1.5, 7):
        i0 = int(np.argmin(np.abs(p[:, 1] - yy)))
        for s in (1, -1):
            lig.append(loft(spline([p[i0], p[i0] + [s * .22, 0, .02], p[i0] + [s * .42, .03, -.10]], 8), .0045, nu=5))
    Vl, Fl, Ul = fusion(lig)
    Vh2 = np.vstack([Vh, Vl]); Fh2 = np.vstack([Fh, Fl + len(Vh)]); Uh2 = np.vstack([Uh, Ul])
    C = np.vstack([C, np.ones((len(Vl), 3)) * lin("#b9a9a5")])
    partie("coeur", "Cœur", "Cœur tubulaire", "circulation", "Un long tube sur le dos, percé de valves. Il pompe une hémolymphe bleue : le cuivre y remplace le fer de notre sang.", Vh2, Fh2, Uh2, C, mat="coeur", extra=dict(bat=True))
    v_ = []
    for i in range(26):
        s = 1 if i % 2 else -1
        y = rng.uniform(.65, 1.55)
        i0 = int(np.argmin(np.abs(p[:, 1] - y)))
        pts = [p[i0]]
        ang = rng.uniform(.25, .75)
        for k in range(8):
            ang += rng.uniform(.14, .3)
            yv = float(np.clip(pts[-1][1] + rng.normal() * .05, .6, 1.6))
            env_ = math.sin(math.pi * ((yv - .28) / 1.78) ** .86) ** .58
            rr_ = .80 * env_
            pts.append(np.array([s * rr_ * .78 * math.cos(ang), yv, Z0 + .08 + rr_ * .72 * math.sin(ang)]))
        pp = dedans(spline(pts, 60), .93)
        v_.append(loft(pp, np.linspace(.010, .0025, 60), nu=6))
    V, F, U = fusion(v_)
    partie("vaisseaux", "Vaisseaux", "Artères de l'abdomen", "circulation", "Des artères quittent le cœur et se perdent entre les organes, qui baignent ensuite directement dans l'hémolymphe.", V, F, U, np.ones((len(V), 3)) * lin("#3e6aa8"), mat="coeur")
    aor = [spline([cz(0, .54, .49), cz(0, .42, .24), cz(0, .3, .08), cz(0, .1, .13), cz(0, -.18, .20), cz(0, -.5, .13), cz(0, -.7, .1)], 44)]
    m = [loft(aor[0], np.linspace(.03, .012, 44), nu=10)]
    for s in (1, -1):
        for y0, x, y1 in ((-.46, .34, -.62), (-.28, .4, -.32), (-.08, .38, -.05)):
            q = spline([cz(0, y0, .15), cz(s * x * .5, (y0 + y1) / 2, .1), cz(s * x, y1, -.02)], 12)
            m.append(loft(q, .009, nu=7))
    V, F, U = fusion(m)
    partie("aorte", "Aorte", "Artères", "circulation", "L'hémolymphe part vers l'avant par cette artère, puis circule librement entre les organes : il n'y a pas de veines.", V, F, U, np.ones((len(V), 3)) * lin("#4b79b5"), mat="coeur")
    # poumons livres : vraies lamelles empilées
    for s in (1, -1):
        for n_paire, (y0, x0) in enumerate(((.62, .32), (1.0, .36)), 1):
            lam = []
            for i in range(34):
                y = y0 + i * .0082
                a = np.linspace(0, 2 * np.pi, 34, endpoint=False)
                bord_ = 1 + .05 * np.sin(a * 5 + i * .7) + .03 * np.sin(a * 11 + i * 1.9)
                ring = np.stack([s * x0 + np.cos(a) * .17 * bord_, np.ones(34) * y + np.sin(a * 3 + i) * .0016, Z0 - .36 + .035 * i * .02 + np.sin(a) * .1 * bord_], -1)
                P = np.stack([ring, ring + [0, .0042, 0]])
                lam.append(grille(P))
            atr = ellipsoide((s * x0, y0 + .13, Z0 - .47), (.13, .16, .025), 18, 8)
            lam.append(atr)
            V, F, U = fusion(lam)
            cote = "gauche" if s > 0 else "droit"
            C = lin("#d9b1a6") * (1 + .1 * np.sin(V[:, 1] * 500))[:, None]
            partie(f"poumon_{'G' if s > 0 else 'D'}{n_paire}", f"Poumon {n_paire} {cote}", "Poumon en livre", "respiration",
                   "Des dizaines de lamelles empilées comme les pages d'un livre. L'air passe entre elles et l'oxygène traverse leur fine paroi. Elle en a quatre.", V, F, U, C, mat="poumon")
    # ovaires : grappes d'oeufs
    mailles = []
    for s in (1, -1):
        for i in range(34):
            t = i / 33
            y = .72 + t * .75 + rng.normal() * .02
            x = s * (.11 + .05 * math.sin(t * 14) + rng.normal() * .012)
            z = -.31 + .03 * math.sin(t * 9) + rng.normal() * .018
            r_ = rng.uniform(.025, .046)
            mailles.append(ellipsoide(cz(x, y, z), (r_, r_ * 1.1, r_), 12, 9))
    V, F, U = fusion(mailles)
    C = lin("#d79b3a") * (1 + .16 * bruit(V, 30, 3))[:, None]
    partie("ovaires", "Ovaires", "Grappes d'œufs", "reproduction", "Deux chapelets d'œufs sous l'intestin. Une femelle pond jusqu'à plusieurs centaines d'œufs dans un cocon de soie.", V, F, U, C, mat="organe")
    # glandes à soie
    m = []
    for s in (1, -1):
        for g, (c, r_) in enumerate([((.16, 1.55, -.33), .07), ((.09, 1.7, -.3), .06), ((.2, 1.38, -.3), .06), ((.1, 1.45, -.38), .05)]):
            m.append(ellipsoide(cz(s * c[0], c[1], c[2]), (r_, r_ * 1.5, r_), 16, 12))
            pts = [cz(s * c[0], c[1], c[2])]
            for k in range(5):
                q = np.array(pts[-1]) + np.array([s * rng.normal() * .03, .1, rng.normal() * .03])
                pts.append(tuple(q))
            pts.append((s * .09, 1.96, Z0 - .03))
            m.append(loft(dedans(spline(pts, 30)), .012, nu=7))
        for i in range(16):
            y = rng.uniform(1.05, 1.7)
            pts = [cz(s * rng.uniform(.05, .28), y, rng.uniform(-.42, -.28))]
            for k in range(7):
                pts.append(tuple(np.array(pts[-1]) + rng.normal(size=3) * [.035, .04, .025] + [0, .05, 0]))
            pts.append((s * .10, 1.96, Z0 - .05))
            m.append(loft(dedans(spline(pts, 34)), .0075, nu=6))
    V, F, U = fusion(m)
    C = lin("#f4efe2") * (1 + .05 * bruit(V, 30, 3))[:, None]
    partie("soie", "Glandes à soie", "Glandes séricigènes", "soie", "Plusieurs sortes de glandes, chacune pour une soie : terrier, cocon ou trappe. La soie y reste liquide jusqu'aux filières.", V, F, U, C, mat="soie")
    # tubes de Malpighi
    m = []
    for i in range(46):
        s = 1 if i % 2 else -1
        pts = [cz(0, 1.52, -.04)]
        for k in range(10):
            pts.append(tuple(np.array(pts[-1]) + rng.normal(size=3) * [.055, .06, .055] + [s * .03, -.025, rng.normal() * .012]))
        m.append(loft(dedans(spline(pts, 34)), .0065, nu=6))
    V, F, U = fusion(m)
    partie("malpighi", "Tubes de Malpighi", "Reins", "digestion", "Ses reins : des tubes très fins qui filtrent l'hémolymphe. Ils éliminent des cristaux blancs presque sans perdre d'eau.", V, F, U, np.ones((len(V), 3)) * lin("#e9c95e"), mat="organe")


TISSUS = {  # relief, finesse des veines, teinte des veines, force
    "estomac": (.007, 16, "#7a2f35", .55), "cerveau": (.009, 22, "#8f7350", .6), "caecums": (.007, 14, "#5a3a1f", .5),
    "diverticules": (.008, 11, "#4a2817", .65), "stercorale": (.006, 13, "#2e1c10", .5), "intestin": (.002, 18, "#6f4a33", .4),
    "coeur": (.002, 26, "#16325f", .55), "aorte": (.001, 26, "#20406f", .3), "ovaires": (.002, 20, "#8c5a1c", .45),
    "soie": (.0015, 24, "#b6ad95", .35), "muscles_thorax": (.002, 30, "#5f1d1a", .45),
}


def tissus():
    for k, p in PARTS.items():
        cle = k if k in TISSUS else ("venin" if k.startswith("venin") else ("muscle" if k.startswith("muscle_") else None))
        reglage = TISSUS.get(cle) or {"venin": (.002, 22, "#6b4b2c", .4), "muscle": (.0012, 34, "#5f1d1a", .5)}.get(cle)
        if not reglage:
            continue
        amp, fr, teinte, force = reglage
        V, F, C = p["V"], p["F"], p["C"]
        n = normales(V, F)
        p["V"] = V + n * (amp * bruit(V, fr * .75, 5))[:, None]
        tache = 1 + .24 * bruit(V + 2.2, fr * .45, 4)
        veine = np.exp(-(bruit(V + 4.1, fr, 4) / .055) ** 2) * np.clip(.6 + bruit(V + 8, fr * .3, 2), 0, 1)
        C = C * tache[:, None]
        p["C"] = C * (1 - (veine * force)[:, None]) + lin(teinte) * (veine * force)[:, None]


def rentrer():
    """Mesure chaque sommet interne contre toutes les coques, puis ramène sous la peau ce qui dépasse."""
    from mathutils.bvhtree import BVHTree
    coques = []
    for k, p in PARTS.items():
        if p["mat"] != "cuticule":
            continue
        Fo = p["F"][:p["nf"]]
        Vo = p["V"][np.unique(Fo)]
        coques.append((BVHTree.FromPolygons(p["V"].tolist(), Fo.tolist(), all_triangles=True), Vo.min(0), Vo.max(0)))
    Vg, Fg, o = [], [], 0
    for k, p in PARTS.items():
        if p["mat"] == "cuticule":
            Vg.append(p["V"]); Fg.append(p["F"][:p["nf"]] + o); o += len(p["V"])
    arbre = BVHTree.FromPolygons(np.vstack(Vg).tolist(), np.vstack(Fg).tolist(), all_triangles=True)

    def dehors(P, m):
        ok = np.zeros(len(P), bool)
        for t, a, b in coques:
            c = np.where(~ok & np.all(P >= a - .01, 1) & np.all(P <= b + .01, 1))[0]
            for i in c:
                q = P[i].tolist()
                loc, nor, _, d = t.find_nearest(q)
                if loc is not None and d >= m and (P[i] - np.array(loc)) @ np.array(nor) < 0:
                    ok[i] = True
        return np.where(~ok)[0]

    bilan = {}
    for k, p in PARTS.items():
        if p["mat"] in ("griffe", "oeil"):
            continue
        if p["mat"] == "cuticule":
            if p["nf"] == len(p["F"]):
                continue
            a, b = p["extra"].get("mur", (len(p["V"]) // 2, len(p["V"])))
            m = .002
        else:
            a, b = 0, len(p["V"])
            m = .012 if (k.startswith("muscle_") or k == "nerfs") else .024
        P = p["V"][a:b]
        avant = len(dehors(P, 0.0))
        for _ in range(3):
            bad = dehors(P, m)
            if not len(bad):
                break
            for i in bad:
                loc, nor, _x, d = arbre.find_nearest(P[i].tolist())
                P[i] = np.array(loc) - np.array(nor) * m * 1.3
        p["V"][a:b] = P
        apres = len(dehors(P, 0.0))
        if avant or apres:
            bilan[k] = (avant, apres)
    print("DEPASSEMENTS (avant, apres) :", json.dumps(bilan), "| total apres :", sum(v[1] for v in bilan.values()))


# ---------- poils ----------
COUPES = {}


def poils(id, n, longueur, larg, couleur, peigne, redresse=.26, ondule=.3, ventre=None):
    p = PARTS[id]
    V, F = p["V"], p["F"][:p["nf"]]
    a = np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1)
    fi = rng.choice(len(F), n, p=a / a.sum())
    r = rng.random((n, 2)); m = r.sum(1) > 1; r[m] = 1 - r[m]
    A, B, D = V[F[fi, 0]], V[F[fi, 1]], V[F[fi, 2]]
    P0 = A + (B - A) * r[:, :1] + (D - A) * r[:, 1:]
    nv = normales(V, F)
    N = unit(nv[F[fi, 0]] + nv[F[fi, 1]] + nv[F[fi, 2]])
    c = peigne(P0, N)
    c = unit(c - N * (c * N).sum(1, keepdims=True))
    meche = np.stack([bruit(P0 + o_, 11, 3) for o_ in (0, 3.1, 7.7)], -1)
    grand = np.stack([bruit(P0 + o_, 3.5, 2) for o_ in (1.3, 5.2, 9.4)], -1)
    L = longueur * np.clip(rng.lognormal(0, .28, (n, 1)), .45, 1.9) * (1 + .22 * bruit(P0 + 5.3, 5, 2))[:, None]
    racine = unit(N * (.45 + redresse) + c * .55 + rng.normal(size=(n, 3)) * .1)
    couche = unit(N * redresse * .35 + c + grand * ondule * .9 + meche * ondule * .75)
    boucle = rng.normal(size=(n, 3)) * ondule * .22 + np.array([0, 0, -.16]) * rng.uniform(.2, 1, (n, 1))
    pts = [P0]
    dirs = []
    for t_ in (.12, .38, .66, 1.0):
        d_ = unit(racine * (1 - t_) ** 1.6 + couche * (1 - (1 - t_) ** 1.6) + boucle * t_ * t_)
        dirs.append(d_)
        pts.append(pts[-1] + d_ * L * .25)
    d = dirs[1]
    cote_ = unit(np.cross(c + grand * .25, N) + rng.normal(size=(n, 3)) * .28)
    w = larg * rng.uniform(.75, 1.3, (n, 1))
    prof = (1.0, .9, .68, .38)
    teinte = (.2, .5, .86, 1.04, 1.22)
    base = couleur(P0, rng.random(n))
    VS = np.empty((n * 9, 3)); NS = np.empty((n * 9, 3)); CS = np.empty((n * 9, 3))
    for q, lg in enumerate(prof):
        dq = dirs[q]
        Nh = unit(N - dq * (N * dq).sum(1, keepdims=True))
        VS[2 * q::9] = pts[q] - cote_ * w * lg
        VS[2 * q + 1::9] = pts[q] + cote_ * w * lg
        NS[2 * q::9] = unit(Nh - cote_ * .75)
        NS[2 * q + 1::9] = unit(Nh + cote_ * .75)
        CS[2 * q::9] = CS[2 * q + 1::9] = base * teinte[q]
    VS[8::9] = pts[4]
    NS[8::9] = unit(N - dirs[3] * (N * dirs[3]).sum(1, keepdims=True))
    CS[8::9] = base * teinte[4]
    POILS.setdefault(id, []).append((VS, NS, CS, n))
    if "fourrure" not in p:
        nvx = F.max() + 1
        p["fourrure"] = sum(couleur(V[:nvx], rng.random(nvx)) for _ in range(6)) / 6
        p["fourrure_longueur"] = longueur


def ton(*hex_, v=.15):
    cs = [lin(h) for h in hex_]
    def f(P, r):
        out = np.zeros((len(P), 3))
        idx = (r * len(cs)).astype(int).clip(0, len(cs) - 1)
        for i, c in enumerate(cs):
            out[idx == i] = c
        return out * (1 + (rng.random((len(P), 1)) - .5) * v * 2)
    return f


def fourrure():
    arriere = lambda P, N: np.tile([0, 1, 0.], (len(P), 1))
    def caraps(P, N):
        return unit((P - np.array([0, -.95, Z0])) * [1, 1, .3])
    def marge(P, r):
        k = np.clip((.07 + .025 * bruit(P, 14, 2) - (P[:, 2] - Z0)) / .05, 0, 1)[:, None]
        return (lin("#a8784a") * k + lin("#17110f") * 1.3 * (1 - k)) * (.8 + .4 * r[:, None])
    poils("carapace", 12500, .042, .0021, marge, caraps, .2)
    poils("carapace", 800, .09, .0021, marge, caraps, .35)
    a_c = ton("#14100f", "#1c1412", "#100d0d", "#3a2118")
    poils("abdomen", 30000, .074, .0024, a_c, arriere, .3)
    rouille = ton("#8e5a30", "#6e3d22", "#a8743f", "#4d2a1a")
    poils("abdomen", 3600, .2, .0024, rouille, arriere, .42, .4)
    poils("pedicelle", 250, .03, .003, ton("#231712"), arriere, .3)
    poils("sternum", 1100, .05, .0034, ton("#160f0d", "#28170f"), arriere, .3)
    for s, code in ((1, "G"), (-1, "D")):
        poils(f"chelicere_{code}", 3600, .062, .0023, ton("#120d0d", "#1c1412", "#22150f"), lambda P, N: np.tile([0, -.3, -1.], (len(P), 1)), .25)
        poils(f"chelicere_{code}", 280, .11, .0021, ton("#b86f34", "#3b2115"), lambda P, N: np.tile([0, -.3, -1.], (len(P), 1)), .35)
        poils(f"palpe_{code}", 2500, .05, .0021, ton("#17100e", "#1e1512"), lambda P, N: np.tile([s * .3, -1, -.5], (len(P), 1)), .28)
        poils(f"palpe_{code}", 180, .11, .0020, ton("#c07a3c", "#2e1b12"), lambda P, N: np.tile([s * .3, -1, -.5], (len(P), 1)), .4)
    PAL = {
        "coxa": (ton("#191210", "#241812"), None), "trochanter": (ton("#191210"), None),
        "femur": (ton("#17110f", "#1d1412", "#241714"), ton("#5b3a26", "#2a1b15")),
        "patelle": (ton("#c9581a", "#ad4413", "#dc7326", "#bc4e16"), ton("#e29a55", "#c9581a")),
        "tibia": (None, ton("#b97a42", "#2d1b12")),
        "metatarse": (ton("#17110f", "#21170f"), ton("#caa070", "#2a1a10")),
        "tarse": (ton("#17110f", "#201610"), ton("#b98c5a", "#21140f")),
    }
    def tibia(P, r, j):
        t = ((P - j[0]) @ unit(j[1] - j[0])) / np.linalg.norm(j[1] - j[0])
        o = lin("#c9581a") * (.7 + .6 * r[:, None])
        n = lin("#17110f") * (.8 + .6 * r[:, None])
        return np.where((np.abs(t - .2) < .13)[:, None], o, n)
    for k, p in list(PARTS.items()):
        ex = p["extra"]
        if "segment" not in ex:
            continue
        seg = ex["segment"]
        T = np.array(ex["tangente"])
        L = np.linalg.norm(T)
        dens = {"coxa": 420, "trochanter": 200, "femur": 1250, "patelle": 900, "tibia": 1050, "metatarse": 780, "tarse": 680}[seg]
        pe = (lambda T: (lambda P, N: np.tile(unit(T), (len(P), 1))))(T)
        cv, cg = PAL[seg]
        if seg == "tibia":
            idx, s = int(k[-1]), 1 if k[-2] == "G" else -1
            j = JOINTS[(idx, s)][4:6]
            cv = (lambda j: (lambda P, r: tibia(P, r, j)))(j)
        poils(k, int(dens * 1.05), .05, .0021, cv, pe, .24)
        if cg:
            poils(k, int(dens * .08), .13 if seg != "tarse" else .09, .0020, cg, pe, .42, .35)
        if seg == "tarse":  # scopule : brosse dense sous le pied
            poils(k, 700, .03, .0023, lambda P, r: lin("#35251a") * (.8 + .5 * r[:, None]), lambda P, N: np.tile([0, 0, -1.], (len(P), 1)), .85, .1)


# ---------- construction & sortie ----------
MATS = {
    "cuticule": dict(rough=.68, coat=.12, coat_r=.4, sss=0),
    "griffe": dict(rough=.16, coat=1, coat_r=.08, sss=0),
    "oeil": dict(rough=.03, coat=1, coat_r=.02, sss=0),
    "organe": dict(rough=.34, coat=.75, coat_r=.18, sss=.45),
    "muscle": dict(rough=.38, coat=.6, coat_r=.2, sss=.4),
    "nerf": dict(rough=.42, coat=.5, coat_r=.25, sss=.5),
    "coeur": dict(rough=.28, coat=.9, coat_r=.12, sss=.45),
    "poumon": dict(rough=.42, coat=.5, coat_r=.22, sss=.55),
    "soie": dict(rough=.3, coat=.8, coat_r=.15, sss=.55),
    "poil": dict(rough=.42, coat=0, coat_r=.3, sss=0),
}


def materiau(nom):
    m = bpy.data.materials.get(nom)
    if m:
        return m
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    n = next(x for x in m.node_tree.nodes if x.type == "BSDF_PRINCIPLED")
    c = m.node_tree.nodes.new("ShaderNodeVertexColor"); c.layer_name = "Col"
    m.node_tree.links.new(c.outputs[0], n.inputs["Base Color"])
    d = MATS[nom]
    n.inputs["Roughness"].default_value = d["rough"]
    n.inputs["Coat Weight"].default_value = d["coat"]
    n.inputs["Coat Roughness"].default_value = d["coat_r"]
    if d["sss"]:
        n.inputs["Subsurface Weight"].default_value = d["sss"]
        n.inputs["Subsurface Radius"].default_value = (.08, .03, .02)
        n.inputs["Subsurface Scale"].default_value = .06
    return m


def construire():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    prosoma(); pattes(); palpes(); chelicere(); abdomen(); organes(); tissus(); rentrer(); fourrure()
    tot = 0
    for k, p in PARTS.items():
        ob = vers_blender(k, p["V"], p["F"], p["U"], p["C"])
        ob.data.materials.append(materiau(p["mat"]))
        tot += len(p["F"])
    print("Parties :", len(PARTS), "triangles :", tot)


def gl(v):  # Blender -> glTF
    v = np.asarray(v, float)
    return np.stack([v[..., 0], v[..., 2], -v[..., 1]], -1)


def exporter_poils():
    """Deux fichiers : a (40 %, seul chargé sur téléphone) et b (le reste). 12 octets/sommet, voir LISEZ-MOI."""
    ECH = 8.0  # position normalisée : valeur int16 / 32767 * ECH
    tables = {"a": {}, "b": {}}
    flux = {"a": [], "b": []}
    nb = {"a": 0, "b": 0}
    tt = 0
    for id, lots in POILS.items():
        VS = np.vstack([l[0] for l in lots]); NS = np.vstack([l[1] for l in lots]); CS = np.vstack([l[2] for l in lots])
        n = len(VS) // 9
        ord_ = rng.permutation(n)
        coupe = int(n * .4)
        for f, sel in (("a", ord_[:coupe]), ("b", ord_[coupe:])):
            if not len(sel):
                continue
            idx = (sel[:, None] * 9 + np.arange(9)).reshape(-1)
            buf = np.zeros(len(idx), dtype=[("p", "<i2", 3), ("n", "i1", 3), ("c", "u1", 3)])
            buf["p"] = np.round(gl(VS[idx]) / ECH * 32767).astype(np.int16)
            buf["n"] = np.round(gl(NS[idx]) * 127).astype(np.int8)
            col = np.clip(CS[idx], 0, 1) ** (1 / 2.2)  # encodé gamma 2.2 : décoder dans le shader
            buf["c"] = np.round(col * 255).astype(np.uint8)
            tables[f][id] = [nb[f], len(sel)]
            nb[f] += len(sel)
            flux[f].append(buf.tobytes())
        tt += n
    for f in flux:
        with open(os.path.join(SORTIE, f"poils-{f}.bin"), "wb") as h:
            for b in flux[f]:
                h.write(b)
    print("Poils :", tt)
    return dict(echelle=ECH, octets_par_sommet=12, sommets_par_poil=9, decalages=dict(position=0, normale=6, couleur=9), index_relatifs=[0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6, 5, 7, 6, 6, 7, 8], fichiers={"a": "poils-a.bin", "b": "poils-b.bin"}, table=tables, poils={"a": nb["a"], "b": nb["b"]})


def exporter():
    poil = exporter_poils()
    data = dict(espece="Brachypelma hamorii", parties=[], poils=poil)
    for k, p in PARTS.items():
        V = p["V"]
        data["parties"].append(dict(id=k, nom=p["nom"], terme=p["terme"], groupe=p["groupe"], texte=p["texte"], mat=p["mat"],
                                    centre=gl(V.mean(0)).round(4).tolist(), mini=gl(V).min(0).round(4).tolist(), maxi=gl(V).max(0).round(4).tolist(),
                                    triangles=len(p["F"])))
    with open(os.path.join(SORTIE, "parties.json"), "w", encoding="utf8") as h:
        json.dump(data, h, ensure_ascii=False, indent=0)
    for k, p in PARTS.items():
        d = next(x for x in data["parties"] if x["id"] == k)
        d["fourrure_longueur"] = p.get("fourrure_longueur", 0)
    with open(os.path.join(SORTIE, "parties.json"), "w", encoding="utf8") as h:
        json.dump(data, h, ensure_ascii=False, indent=0)
    for o in bpy.context.scene.objects:
        o.select_set(o.name in PARTS)
    bpy.ops.export_scene.gltf(filepath=os.path.join(SORTIE, "araignee.glb"), export_format="GLB", use_selection=True, export_apply=False,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_materials="EXPORT",
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
                              export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_color_quantization=8)


def tuile(nom, spectre, force):
    n = 512
    fx = np.fft.fftfreq(n)[:, None]; fy = np.fft.fftfreq(n)[None, :]
    f = np.sqrt(fx * fx + fy * fy) + 1e-6
    h = np.real(np.fft.ifft2(np.fft.fft2(rng.normal(size=(n, n))) * spectre(f)))
    h = (h - h.mean()) / h.std()
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * force
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * force
    N = unit(np.stack([-dx, -dy, np.ones_like(h)], -1))
    px = np.ones((n, n, 4)); px[..., :3] = N * .5 + .5
    im = bpy.data.images.new(nom, n, n, alpha=False, float_buffer=False)
    im.colorspace_settings.name = "Non-Color"
    im.pixels.foreach_set(px.reshape(-1).astype(np.float32))
    im.filepath_raw = os.path.join(SORTIE, nom + ".png"); im.file_format = "PNG"; im.save()


def exporter_peau():
    """peau.glb : surface extérieure seule (sans mur intérieur), colorée comme le velours."""
    tmp = []
    for k, p in PARTS.items():
        if "fourrure" not in p:
            continue
        F = p["F"][:p["nf"]]
        nvx = F.max() + 1
        ob = vers_blender("peau_" + k, p["V"][:nvx], F, p["U"][F.reshape(-1)].reshape(0, 3, 2) if False else None, np.clip(p["fourrure"], 0, 1))
        ob.data.materials.append(materiau("poil"))
        tmp.append(ob)
    for o in bpy.context.scene.objects:
        o.select_set(o in tmp)
    bpy.ops.export_scene.gltf(filepath=os.path.join(SORTIE, "peau.glb"), export_format="GLB", use_selection=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_materials="NONE",
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
                              export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_color_quantization=8)
    for ob in tmp:
        me = ob.data
        bpy.data.objects.remove(ob); bpy.data.meshes.remove(me)


def scene_apercu():
    # poils en un seul objet pour le rendu de contrôle
    Vs, Fs, Cs, o = [], [], [], 0
    for id, lots in POILS.items():
        for VS, NS, CS, n in lots:
            Vs.append(VS); Cs.append(CS)
            b = o + np.arange(n)[:, None] * 9
            for t3 in ((0, 1, 2), (1, 3, 2), (2, 3, 4), (3, 5, 4), (4, 5, 6), (5, 7, 6), (6, 7, 8)):
                Fs.append(np.hstack([b + t3[0], b + t3[1], b + t3[2]]))
            o += len(VS)
    ob = vers_blender("POILS", np.vstack(Vs), np.vstack(Fs), None, np.clip(np.vstack(Cs), 0, 2))
    ob.data.materials.append(materiau("poil"))
    # table
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    t = bpy.context.object; t.name = "TABLE"
    m = bpy.data.materials.new("table"); m.use_nodes = True
    n = next(x for x in m.node_tree.nodes if x.type == "BSDF_PRINCIPLED")
    n.inputs["Base Color"].default_value = (*lin("#d9dee0"), 1); n.inputs["Roughness"].default_value = .35
    t.data.materials.append(m)
    w = bpy.data.worlds.new("w"); bpy.context.scene.world = w; w.use_nodes = True
    e = w.node_tree.nodes.new("ShaderNodeTexEnvironment")
    e.image = bpy.data.images.load(os.path.normpath(os.path.join(ICI, "..", "..", "console-retro-3d", "assets", "studio-small-09-1k.hdr")))
    bg = next(x for x in w.node_tree.nodes if x.type == "BACKGROUND")
    w.node_tree.links.new(e.outputs[0], bg.inputs[0]); bg.inputs[1].default_value = .9
    bpy.ops.object.light_add(type="AREA", location=(3, -3, 6)); l = bpy.context.object; l.data.energy = 260; l.data.size = 3
    l.rotation_euler = (math.radians(30), math.radians(25), 0)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"; sc.cycles.samples = 90; sc.cycles.use_denoising = True
    try:
        pr = bpy.context.preferences.addons["cycles"].preferences
        pr.compute_device_type = "OPTIX"; pr.get_devices()
        for d in pr.devices:
            d.use = d.type == "OPTIX"
        sc.cycles.device = "GPU"
    except Exception as ex:
        print("GPU indisponible", ex)
    sc.render.resolution_x, sc.render.resolution_y = 1280, 800
    sc.view_settings.view_transform = "AgX"


def vue(nom, pos, cible, focale=55, cacher=()):
    sc = bpy.context.scene
    cam = bpy.data.cameras.new(nom); cam.lens = focale; cam.clip_start = .05
    ob = bpy.data.objects.new(nom, cam); bpy.context.collection.objects.link(ob)
    ob.location = pos
    d = np.array(cible) - np.array(pos)
    from mathutils import Vector
    ob.rotation_euler = Vector(d).to_track_quat("-Z", "Y").to_euler()
    sc.camera = ob
    for o in sc.objects:
        if o.type == "MESH":
            o.hide_render = any(o.name.startswith(c) for c in cacher)
    sc.render.filepath = os.path.join(ICI, "apercus", nom + ".png")
    os.makedirs(os.path.dirname(sc.render.filepath), exist_ok=True)
    bpy.ops.render.render(write_still=True)


COQUES = ("POILS", "carapace", "abdomen", "sternum", "pedicelle", "chelicere", "palpe", "coxa", "trochanter", "femur", "patelle", "tibia", "metatarse", "tarse", "labium", "maxilles", "yeux", "crochet", "filieres")

if __name__ == "__main__":
    construire()
    exporter()
    exporter_peau()
    tuile("relief-cuticule", lambda f: np.exp(-((f - .16) / .05) ** 2) + .35 * np.exp(-((f - .04) / .02) ** 2), .35)
    tuile("relief-organe", lambda f: np.exp(-((f - .035) / .012) ** 2) + .25 * np.exp(-((f - .18) / .06) ** 2), 1.3)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ICI, "ecorchee.blend"))
    r = os.environ.get("RENDU", "")
    if r:
        scene_apercu()
        if "hero" in r:
            vue("hero", (4.8, -7.8, 4.4), (0, .15, .45), 58)
        if "tete" in r:
            vue("tete", (1.6, -4.6, 2.0), (0, -.55, .62), 62)
        if "dessus" in r:
            vue("dessus", (0, .4, 9.5), (0, .4, 0), 50)
        if "organes" in r:
            vue("organes", (3.2, -2.6, 2.5), (0, .5, .7), 55, cacher=COQUES)
            vue("organes_dessus", (0, .5, 6.5), (0, .5, .7), 50, cacher=COQUES + ("diverticules",))
    print("FINI")
