import express from "express";
import { priceCart } from "./pricing";

const app = express();
app.use(express.json());

app.post("/checkout", async (req, res) => {
  const total = await priceCart(req.body.items ?? []);
  res.json({ total });
});

app.listen(Number(process.env.PORT ?? 8080));
