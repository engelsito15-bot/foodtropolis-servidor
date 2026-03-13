const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
require('dotenv').config(); 
const multer = require("multer");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// --- 1. NUEVAS LIBRERÍAS PARA TIEMPO REAL 
const http = require('http');
const { Server } = require("socket.io");

const JWT_SECRET = process.env.JWT_SECRET || "firma_secreta_foodtropolis_2026"; 

const app = express();

// --- 2. CREAMOS EL TÚNEL DE COMUNICACIÓN ---
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000", // Permite que el frontend se conecte a la antena
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// Aviso cuando alguien se conecta al túnel
io.on("connection", (socket) => {
  console.log(`📡 Un usuario se conectó en tiempo real: ${socket.id}`);
  socket.on("disconnect", () => {
    console.log("🔌 Un usuario se desconectó");
  });
});

app.use(cors()); 
app.use(express.json()); 
app.use("/uploads", express.static(path.join(__dirname, "public/uploads"))); 

const storage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, "public/uploads"); },
  filename: (req, file, cb) => { cb(null, Date.now() + path.extname(file.originalname)); }
});
const upload = multer({ storage: storage });

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

db.connect((err) => {
    if (err) { console.error('Error bd:', err); return; }
    console.log('✅ ¡Conectado a la BD Foodtropolis!');
});

// ==========================================
// RUTA SECRETA PARA SUPER ADMIN
// ==========================================
app.get("/api/setup-admin", async (req, res) => {
  try {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash("admin123", salt);
    db.query("INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ('Super Admin', 'admin@foodtropolis.com', ?, 'admin')", [hash], (err) => {
      if (err) return res.send("El admin ya existe o hubo un error.");
      res.send("<h1>✅ ¡Super Admin creado con éxito!</h1>");
    });
  } catch (error) { res.send("Error encriptando."); }
});


// ==========================================
// SISTEMA DE LOGIN SEGURO
// ==========================================
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  db.query("SELECT * FROM usuarios WHERE email = ?", [email], async (err, results) => {
    if (err) return res.status(500).json({ error: "Error en el servidor" });
    if (results.length === 0) return res.status(401).json({ error: "Credenciales incorrectas" });
    const usuario = results[0];
    const passwordValida = await bcrypt.compare(password, usuario.password_hash);
    if (!passwordValida) return res.status(401).json({ error: "Credenciales incorrectas" });

    const token = jwt.sign({ id: usuario.id, rol: usuario.rol, restaurante_id: usuario.restaurante_id }, JWT_SECRET, { expiresIn: "8h" });
    res.json({ message: "Login exitoso", token: token, usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol, restaurante_id: usuario.restaurante_id } });
  });
});

// ==========================================
// RUTAS DEL SUPER ADMINISTRADOR
// ==========================================
app.get("/api/usuarios/duenos", (req, res) => {
  db.query("SELECT id, nombre, email FROM usuarios WHERE rol = 'dueno'", (err, results) => {
    if (err) return res.status(500).json({ error: "Error" });
    res.json(results);
  });
});

app.post("/api/usuarios", async (req, res) => {
  const { nombre, email, password } = req.body;
  try {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    db.query("INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, 'dueno')", [nombre, email, passwordHash], (err, result) => {
      if (err) return res.status(500).json({ error: "Error al crear usuario" });
      res.json({ message: "Usuario creado exitosamente", id: result.insertId });
    });
  } catch (error) { res.status(500).json({ error: "Error de seguridad" }); }
});

app.post("/api/restaurantes", upload.single('imagen'), (req, res) => {
  const { nombre, tipo_comida, usuario_id } = req.body; 
  const imagen_url = req.file ? `http://localhost:3001/uploads/${req.file.filename}` : "";
  db.query("INSERT INTO restaurantes (usuario_id, nombre, tipo_comida, imagen_url) VALUES (?, ?, ?, ?)", [usuario_id, nombre, tipo_comida, imagen_url], (err, result) => {
    if (err) return res.status(500).json({ error: "Error" });
    db.query("UPDATE usuarios SET restaurante_id = ? WHERE id = ?", [result.insertId, usuario_id]);
    res.json({ message: "¡Foodtruck guardado!", id: result.insertId });
  });
});

app.put("/api/restaurantes/:id", upload.single('imagen'), (req, res) => {
  const { nombre, tipo_comida, usuario_id } = req.body;
  const id = req.params.id;
  let query, params;
  if (req.file) {
    const imagen_url = `http://localhost:3001/uploads/${req.file.filename}`;
    query = "UPDATE restaurantes SET nombre = ?, tipo_comida = ?, usuario_id = ?, imagen_url = ? WHERE id = ?";
    params = [nombre, tipo_comida, usuario_id, imagen_url, id];
  } else {
    query = "UPDATE restaurantes SET nombre = ?, tipo_comida = ?, usuario_id = ? WHERE id = ?";
    params = [nombre, tipo_comida, usuario_id, id];
  }
  db.query(query, params, (err) => {
    if (err) return res.status(500).json({ error: "Error al actualizar" });
    db.query("UPDATE usuarios SET restaurante_id = ? WHERE id = ?", [id, usuario_id]);
    res.json({ message: "Foodtruck actualizado" });
  });
});

app.delete("/api/restaurantes/:id", (req, res) => {
  db.query("DELETE FROM restaurantes WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: "Error al borrar" });
    res.json({ message: "Foodtruck eliminado" });
  });
});

// ==========================================
// RUTAS PÚBLICAS Y MENÚ
// ==========================================
app.get('/api/restaurantes', (req, res) => {
  db.query('SELECT id, nombre, descripcion, tipo_comida, imagen_url FROM restaurantes', (err, results) => {
      if (err) return res.status(500).json({ error: 'Error' });
      res.json(results);
  });
});

app.get("/api/restaurantes/:id", (req, res) => {
  db.query("SELECT * FROM restaurantes WHERE id = ?", [req.params.id], (err, result) => {
    if (err) return res.status(500).json({ error: "Error" });
    res.json(result[0]);
  });
});

app.get("/api/restaurantes/:id/platos", (req, res) => {
  db.query("SELECT * FROM platos WHERE restaurante_id = ?", [req.params.id], (err, results) => {
    if (err) return res.status(500).json({ error: "Error" });
    res.json(results);
  });
});

// ==========================================
// RUTAS DE PEDIDOS Y COCINA (CON AVISOS EN TIEMPO REAL)
// ==========================================
app.post("/api/pedidos", (req, res) => {
  const { restaurante_id, cliente_nombre, numero_mesa, total, carrito, comentarios } = req.body;
  db.query("INSERT INTO pedidos (restaurante_id, cliente_nombre, numero_mesa, total, comentarios) VALUES (?, ?, ?, ?, ?)", [restaurante_id, cliente_nombre, numero_mesa, total, comentarios], (err, result) => {
    if (err) return res.status(500).json({ error: "Error" });
    const pedido_id = result.insertId; 
    const detalles = carrito.map(item => [pedido_id, item.id, item.cantidad, item.precio]);
    db.query("INSERT INTO detalles_pedido (pedido_id, plato_id, cantidad, precio_unitario) VALUES ?", [detalles], (err) => {
      if (err) return res.status(500).json({ error: "Error" });
      
      // 📣 ¡MAGIA! El servidor le grita a la cocina que llegó un pedido nuevo
      io.emit("actualizacion_pedidos", { restaurante_id }); 

      res.json({ message: "Orden enviada", ticket: pedido_id });
    });
  });
});

app.get("/api/pedidos/:id", (req, res) => {
  db.query("SELECT * FROM pedidos WHERE id = ?", [req.params.id], (err, result) => {
    if (err) return res.status(500).json({ error: "Error" });
    res.json(result[0]);
  });
});

app.get("/api/restaurantes/:id/pedidos", (req, res) => {
  db.query("SELECT * FROM pedidos WHERE restaurante_id = ? AND estado NOT IN ('entregado', 'rechazado') ORDER BY id ASC", [req.params.id], (err, pedidos) => {
    if (err) return res.status(500).json({ error: "Error" });
    if (pedidos.length === 0) return res.json([]); 
    const pedidoIds = pedidos.map(p => p.id);
    db.query("SELECT dp.*, p.nombre as plato_nombre FROM detalles_pedido dp JOIN platos p ON dp.plato_id = p.id WHERE dp.pedido_id IN (?)", [pedidoIds], (err, detalles) => {
      if (err) return res.status(500).json({ error: "Error" });
      res.json(pedidos.map(pedido => ({ ...pedido, platos: detalles.filter(d => d.pedido_id === pedido.id) })));
    });
  });
});

app.put("/api/pedidos/:id/estado", (req, res) => {
  const { estado, tiempo_estimado } = req.body;
  let query = "UPDATE pedidos SET estado = ?";
  let params = [estado];
  if (tiempo_estimado) { query += ", tiempo_estimado = ?"; params.push(tiempo_estimado); }
  query += " WHERE id = ?"; params.push(req.params.id);
  db.query(query, params, (err) => {
    if (err) return res.status(500).json({ error: "Error" });

    // 📣 ¡MAGIA! El servidor avisa que el pedido cambió de estado (ej: de Pendiente a Preparando)
    io.emit("estado_cambiado", { pedido_id: req.params.id, estado });

    res.json({ message: "Actualizado" });
  });
});

app.get("/api/restaurantes/:id/historial", (req, res) => {
  db.query("SELECT * FROM pedidos WHERE restaurante_id = ? AND estado IN ('entregado', 'rechazado') ORDER BY id DESC", [req.params.id], (err, pedidos) => {
    if (err) return res.status(500).json({ error: "Error" });
    if (pedidos.length === 0) return res.json([]); 
    const pedidoIds = pedidos.map(p => p.id);
    db.query("SELECT dp.*, p.nombre as plato_nombre FROM detalles_pedido dp JOIN platos p ON dp.plato_id = p.id WHERE dp.pedido_id IN (?)", [pedidoIds], (err, detalles) => {
      if (err) return res.status(500).json({ error: "Error" });
      res.json(pedidos.map(pedido => ({ ...pedido, platos: detalles.filter(d => d.pedido_id === pedido.id) })));
    });
  });
});

// ==========================================
// RUTAS DEL GESTOR DE MENÚ
// ==========================================
app.post("/api/platos", (req, res) => {
  const { restaurante_id, nombre, descripcion, precio, en_oferta, categoria } = req.body;
  db.query("INSERT INTO platos (restaurante_id, nombre, descripcion, precio, en_oferta, categoria) VALUES (?, ?, ?, ?, ?, ?)", [restaurante_id, nombre, descripcion, precio, en_oferta ? 1 : 0, categoria || 'General'], (err, result) => {
    if (err) return res.status(500).json({ error: "Error" });
    res.json({ message: "Guardado", id: result.insertId });
  });
});

app.put("/api/platos/:id", (req, res) => {
  const { nombre, descripcion, precio, en_oferta, categoria } = req.body;
  db.query("UPDATE platos SET nombre = ?, descripcion = ?, precio = ?, en_oferta = ?, categoria = ? WHERE id = ?", [nombre, descripcion, precio, en_oferta ? 1 : 0, categoria || 'General', req.params.id], (err) => {
    if (err) return res.status(500).json({ error: "Error" });
    res.json({ message: "Actualizado" });
  });
});

app.delete("/api/platos/:id", (req, res) => {
  db.query("DELETE FROM platos WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: "Error" });
    res.json({ message: "Eliminado" });
  });
});

app.get("/api/restaurantes/:id/categorias", (req, res) => {
  db.query("SELECT * FROM categorias WHERE restaurante_id = ?", [req.params.id], (err, results) => {
    if (err) return res.status(500).json({ error: "Error" });
    res.json(results);
  });
});

app.post("/api/categorias", (req, res) => {
  const { restaurante_id, nombre } = req.body;
  db.query("INSERT INTO categorias (restaurante_id, nombre) VALUES (?, ?)", [restaurante_id, nombre], (err, result) => {
    if (err) return res.status(500).json({ error: "Error" });
    res.json({ message: "Categoría creada", id: result.insertId });
  });
});

app.delete("/api/categorias/:id", (req, res) => {
  db.query("DELETE FROM categorias WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: "Error" });
    res.json({ message: "Categoría eliminada" });
  });
});

// ==========================================
// GALERÍA DE FOTOS
// ==========================================
app.post("/api/galeria", upload.single('imagen'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No imagen" });
  const imagen_url = `http://localhost:3001/uploads/${req.file.filename}`;
  db.query("INSERT INTO galeria (imagen_url, estado) VALUES (?, 'pendiente')", [imagen_url], (err) => {
    if (err) return res.status(500).json({ error: "Error bd" });
    res.json({ message: "¡Foto enviada!" });
  });
});

app.get("/api/galeria/publica", (req, res) => {
  db.query("SELECT * FROM galeria WHERE estado = 'aprobada' ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: "Error" });
    res.json(results);
  });
});

app.get("/api/galeria/admin", (req, res) => {
  db.query("SELECT * FROM galeria ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: "Error" });
    res.json(results);
  });
});

app.put("/api/galeria/:id/estado", (req, res) => {
  const { estado } = req.body; 
  db.query("UPDATE galeria SET estado = ? WHERE id = ?", [estado, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: "Error" });
    res.json({ message: "Actualizado" });
  });
});

// --- 3. CAMBIAMOS APP.LISTEN POR SERVER.LISTEN ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`🚀 Servidor y WebSockets corriendo en http://localhost:${PORT}`);
});
// ==========================================
// SISTEMA DE RESEÑAS REALES ⭐
// ==========================================
// 1. Guardar una nueva reseña cuando el cliente califica
app.post("/api/resenas", (req, res) => {
  const { restaurante_id, cliente_nombre, calificacion, comentario } = req.body;
  db.query("INSERT INTO resenas (restaurante_id, cliente_nombre, calificacion, comentario) VALUES (?, ?, ?, ?)", 
  [restaurante_id, cliente_nombre, calificacion, comentario], (err) => {
    if (err) return res.status(500).json({ error: "Error guardando reseña" });
    res.json({ message: "¡Gracias por tu opinión!" });
  });
});

// 2. Traer las últimas reseñas para la página principal
app.get("/api/resenas/destacadas", (req, res) => {
  db.query(`
    SELECT r.*, rest.nombre as restaurante_nombre 
    FROM resenas r 
    JOIN restaurantes rest ON r.restaurante_id = rest.id 
    ORDER BY r.id DESC LIMIT 6
  `, (err, results) => {
    if (err) return res.status(500).json({ error: "Error obteniendo reseñas" });
    res.json(results);
  });
});