const express = require("express");
const { Sequelize, DataTypes, Op } = require("sequelize");

// --- 1. INITIALIZE APP AND DATABASE ---

// Initialize Express app
const app = express();
app.use(express.json()); // Middleware to parse JSON bodies

// Initialize Sequelize with an in-memory SQLite database
// For file-based storage, you would use: new Sequelize({ dialect: 'sqlite', storage: 'posts.db' });
const sequelize = new Sequelize("sqlite::memory:");

// --- 2. DEFINE DATABASE MODELS ---

// Post Model
const Post = sequelize.define(
  "Post",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    post_str_id: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
  },
  {
    tableName: "posts",
    timestamps: true,
  }
);

// Like Model
const Like = sequelize.define(
  "Like",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    user_id_str: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  {
    tableName: "likes",
    timestamps: true,
    // A user can only like a post once.
    indexes: [
      {
        unique: true,
        fields: ["user_id_str", "PostId"],
      },
    ],
  }
);

// --- 3. DEFINE MODEL ASSOCIATIONS ---

Post.hasMany(Like, { onDelete: "CASCADE" });
Like.belongsTo(Post);

// --- 4. API ENDPOINTS ---

/**
 * POST /posts
 * Creates a new post.
 * Body: {"post_str_id": "...", "content": "..."}
 */
app.post("/posts", async (req, res) => {
  const { post_str_id, content } = req.body;
  if (!post_str_id || !content) {
    return res.status(400).json({ error: "Invalid input" });
  }

  try {
    const [post, created] = await Post.findOrCreate({
      where: { post_str_id: post_str_id },
      defaults: { content: content },
    });

    if (!created) {
      return res
        .status(409)
        .json({ error: "Post with this ID already exists" });
    }

    res.status(201).json({
      internal_db_id: post.id,
      post_str_id: post.post_str_id,
      status: "created",
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});

/**
 * POST /posts/:post_str_id/like
 * Adds a like to a specific post.
 * Body: {"user_id_str": "..."}
 */
app.post("/posts/:post_str_id/like", async (req, res) => {
  try {
    const post = await Post.findOne({
      where: { post_str_id: req.params.post_str_id },
    });
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    const { user_id_str } = req.body;
    if (!user_id_str) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const [like, created] = await Like.findOrCreate({
      where: { user_id_str: user_id_str, PostId: post.id },
    });

    if (!created) {
      return res.status(200).json({ status: "already_liked" });
    }

    res.status(201).json({ status: "liked" });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});

/**
 * GET /posts/:post_str_id/likes
 * Retrieves the total number of likes for a specific post.
 */
app.get("/posts/:post_str_id/likes", async (req, res) => {
  try {
    const post = await Post.findOne({
      where: { post_str_id: req.params.post_str_id },
    });
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    // Sequelize provides a `count<ModelName>s` method for hasMany associations
    const likeCount = await post.countLikes();

    res.status(200).json({
      post_str_id: post.post_str_id,
      like_count: likeCount,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});

/**
 * DELETE /posts/:post_str_id/like
 * Removes a like from a specific post.
 * Body: {"user_id_str": "..."}
 */
app.delete("/posts/:post_str_id/like", async (req, res) => {
  try {
    const post = await Post.findOne({
      where: { post_str_id: req.params.post_str_id },
    });
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    const { user_id_str } = req.body;
    if (!user_id_str) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const deletedCount = await Like.destroy({
      where: {
        user_id_str: user_id_str,
        PostId: post.id,
      },
    });

    if (deletedCount === 0) {
      return res.status(200).json({ status: "not_liked_previously" });
    }

    res.status(200).json({ status: "unliked" });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});

/**
 * GET /posts/top
 * Retrieves the top N posts with the most likes.
 * Query: ?limit=N
 */
app.get("/posts/top", async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 5;

  try {
    const topPosts = await Post.findAll({
      attributes: {
        include: [
          [sequelize.fn("COUNT", sequelize.col("Likes.id")), "like_count"],
        ],
      },
      include: [
        {
          model: Like,
          attributes: [],
        },
      ],
      group: ["Post.id"],
      order: [[sequelize.literal("like_count"), "DESC"]],
      limit: limit,
      subQuery: false, // Important for correct limit/grouping behavior
    });

    // The result needs to be formatted to match the desired output
    const result = topPosts.map((post) => ({
      post_str_id: post.post_str_id,
      like_count: parseInt(post.dataValues.like_count, 10),
    }));

    res.status(200).json(result);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});

/**
 * GET /users/:user_id_str/liked-posts
 * Retrieves all post identifiers that a specific user has liked.
 */
app.get("/users/:user_id_str/liked-posts", async (req, res) => {
  try {
    const userLikes = await Like.findAll({
      where: { user_id_str: req.params.user_id_str },
      include: [
        {
          model: Post,
          attributes: ["post_str_id"],
        },
      ],
    });

    const likedPostIds = userLikes.map((like) => like.Post.post_str_id);

    res.status(200).json(likedPostIds);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});

// --- 5. START SERVER ---
const PORT = process.env.PORT || 3000;

// Sync database and start server
sequelize
  .sync()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log("Database synchronized.");
    });
  })
  .catch((error) => {
    console.error("Unable to connect to the database:", error);
  });

/**
 * To run this file:
 * 1. Make sure you have Node.js installed.
 * 2. In your terminal, run `npm install express sequelize sqlite3`.
 * 3. Save the code as `index.js`.
 * 4. Run `node index.js`.
 */
