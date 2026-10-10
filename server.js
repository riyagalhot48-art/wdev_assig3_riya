require("dotenv").config();

const dns = require("dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const mongoose = require("mongoose");
const Product = require("./models/Product");

const app = express();
app.use(express.json());
// 1. CREATE PRODUCT
app.post("/api/products", async (req, res, next) => {
  try {
    const product = await Product.create(req.body);
    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

// 2. GET ALL PRODUCTS: FILTER, SORT, PAGINATION
app.get("/api/products", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit) || 10)
    );

    const filter = {};

    if (req.query.category) {
      filter.category = req.query.category;
    }

    if (req.query.search) {
      filter.name = {
        $regex: req.query.search,
        $options: "i"
      };
    }

    if (req.query.minPrice || req.query.maxPrice) {
      filter.price = {};

      if (req.query.minPrice) {
        filter.price.$gte = Number(req.query.minPrice);
      }

      if (req.query.maxPrice) {
        filter.price.$lte = Number(req.query.maxPrice);
      }
    }

    const allowedSortFields = [
      "name",
      "price",
      "quantity",
      "createdAt"
    ];

    const sortBy = allowedSortFields.includes(req.query.sortBy)
      ? req.query.sortBy
      : "createdAt";

    const order = req.query.order === "asc" ? 1 : -1;

    const total = await Product.countDocuments(filter);

    const products = await Product.find(filter)
      .sort({ [sortBy]: order })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      count: products.length,
      products
    });
  } catch (err) {
    next(err);
  }
});

// 3. GET SINGLE PRODUCT BY ID
app.get("/api/products/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid product ID"
      });
    }

    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        message: "Product not found"
      });
    }

    res.json(product);
  } catch (err) {
    next(err);
  }
});

// 4. UPDATE PRODUCT DETAILS
app.put("/api/products/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid product ID"
      });
    }

    const allowedFields = [
      "name",
      "sku",
      "category",
      "price",
      "quantity",
      "reorderLevel",
      "supplier"
    ];

    const updates = {};

    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      updates,
      {
        new: true,
        runValidators: true
      }
    );

    if (!product) {
      return res.status(404).json({
        message: "Product not found"
      });
    }

    res.json(product);
  } catch (err) {
    next(err);
  }
});

// 5. DELETE PRODUCT
app.delete("/api/products/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid product ID"
      });
    }

    const product = await Product.findByIdAndDelete(
      req.params.id
    );

    if (!product) {
      return res.status(404).json({
        message: "Product not found"
      });
    }

    res.json({
      message: "Product deleted",
      id: product._id
    });
  } catch (err) {
    next(err);
  }
});

// 6. STOCK ADJUSTMENT
app.patch("/api/products/:id/stock", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid product ID"
      });
    }

    const change = req.body.change;

    if (!Number.isInteger(change) || change === 0) {
      return res.status(400).json({
        message: "change must be a non-zero integer"
      });
    }

    const filter = { _id: req.params.id };

    if (change < 0) {
      filter.quantity = { $gte: -change };
    }

    const product = await Product.findOneAndUpdate(
      filter,
      { $inc: { quantity: change } },
      { new: true, runValidators: true }
    );

    if (!product) {
      const exists = await Product.exists({
        _id: req.params.id
      });

      return res.status(exists ? 400 : 404).json({
        message: exists
          ? "Insufficient stock"
          : "Product not found"
      });
    }

    res.json({
      message: "Stock updated",
      product
    });
  } catch (err) {
    next(err);
  }
});

// 7. LOW-STOCK ALERT REPORT
app.get("/api/products/low-stock", async (req, res, next) => {
  try {
    const lowStockItems = await Product.find({
      $expr: {
        $lte: ["$quantity", "$reorderLevel"]
      }
    });

    res.json({
      count: lowStockItems.length,
      lowStockItems
    });
  } catch (err) {
    next(err);
  }
});

// 8. CATEGORY-WISE INVENTORY SUMMARY
app.get("/api/products/summary", async (req, res, next) => {
  try {
    const summary = await Product.aggregate([
      {
        $group: {
          _id: "$category",
          totalItems: { $sum: 1 },
          totalQuantity: { $sum: "$quantity" },
          totalStockValue: {
            $sum: {
              $multiply: ["$price", "$quantity"]
            }
          },
          avgPrice: { $avg: "$price" }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    res.json({
      categories: summary.length,
      summary
    });
  } catch (err) {
    next(err);
  }
});

// 9. CENTRALIZED ERROR HANDLER
app.use((err, req, res, next) => {
  console.error(err.message);

  if (err.name === "ValidationError") {
    return res.status(400).json({
      message: "Validation failed",
      error: err.message
    });
  }

  if (err.name === "CastError") {
    return res.status(400).json({
      message: "Invalid ID or value"
    });
  }

  if (err.code === 11000) {
    return res.status(409).json({
      message: "SKU already exists"
    });
  }

  res.status(500).json({
    message: "Internal server error"
  });
});

// 10. CONNECT DATABASE AND START SERVER
const PORT = process.env.PORT || 5000;

if (!process.env.MONGO_URI) {
  console.error("MONGO_URI is missing from your .env file");
  process.exit(1);
}

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected successfully");

    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Database connection failed:", err.message);
    process.exit(1);
  });
  