import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import * as kv from "./kv_store.tsx";

// Initialize Supabase Admin Client (for server-side auth operations)
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const app = new Hono();

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// ============================================
// AUTH ROUTES
// ============================================

/**
 * Sign Up - Creates a new user with unique email and password
 * This ensures only these credentials can be used to login
 */
app.post("/make-server-8828d0dd/auth/signup", async (c) => {
  try {
    const { email, password, name, role, roll_number, phone_number, emergency_phone } = await c.req.json();

    // Validate inputs
    if (!email || !password || !name || !role) {
      return c.json({ error: "Email, password, name, and role are required" }, 400);
    }

    if (password.length < 6) {
      return c.json({ error: "Password must be at least 6 characters long" }, 400);
    }

    // Check if user already exists
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const userExists = existingUsers?.users?.some(u => u.email === email);

    if (userExists) {
      return c.json({ error: "An account with this email already exists" }, 400);
    }

    // Create user with Supabase Auth
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm since we don't have email server
      user_metadata: {
        name,
        role, // 'student' or 'parent'
        roll_number: roll_number || null,
        phone_number: phone_number || null,
        emergency_phone: emergency_phone || null,
      }
    });

    if (error) {
      console.error("Signup error:", error);
      return c.json({ error: error.message || "Failed to create account" }, 400);
    }

    if (!data.user) {
      return c.json({ error: "Failed to create user" }, 500);
    }

    console.log(`User created successfully: ${email} (${role})`);

    return c.json({
      success: true,
      message: "Account created successfully",
      user: {
        id: data.user.id,
        email: data.user.email,
        name,
        role,
        roll_number,
        phone_number,
        emergency_phone
      }
    });
  } catch (err: any) {
    console.error("Signup error:", err);
    return c.json({ error: err.message || "Internal server error" }, 500);
  }
});

/**
 * Verify Auth - Middleware to verify user is authenticated
 * This ensures routes are protected and only accessible with valid credentials
 */
async function verifyAuth(authHeader: string | null): Promise<{ userId: string; email: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.split(' ')[1];
  
  const { data, error } = await supabase.auth.getUser(token);
  
  if (error || !data.user) {
    return null;
  }

  return {
    userId: data.user.id,
    email: data.user.email || ''
  };
}

// ============================================
// PROTECTED ROUTES (Require Authentication)
// ============================================

/**
 * Save user's selected university
 */
app.post("/make-server-8828d0dd/user/university", async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    const user = await verifyAuth(authHeader);

    if (!user) {
      return c.json({ error: "Unauthorized - Please login with your credentials" }, 401);
    }

    const { university_id } = await c.req.json();

    if (!university_id) {
      return c.json({ error: "University ID is required" }, 400);
    }

    // Save to KV store
    await kv.set(`user:${user.userId}:university`, university_id);

    return c.json({
      success: true,
      message: "University saved successfully"
    });
  } catch (err: any) {
    console.error("Save university error:", err);
    return c.json({ error: err.message || "Internal server error" }, 500);
  }
});

/**
 * Save user's location
 */
app.post("/make-server-8828d0dd/user/location", async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    const user = await verifyAuth(authHeader);

    if (!user) {
      return c.json({ error: "Unauthorized - Please login with your credentials" }, 401);
    }

    const { latitude, longitude, address } = await c.req.json();

    if (!latitude || !longitude) {
      return c.json({ error: "Latitude and longitude are required" }, 400);
    }

    // Save to KV store
    await kv.set(`user:${user.userId}:location`, {
      latitude,
      longitude,
      address: address || null,
      updated_at: new Date().toISOString()
    });

    return c.json({
      success: true,
      message: "Location saved successfully"
    });
  } catch (err: any) {
    console.error("Save location error:", err);
    return c.json({ error: err.message || "Internal server error" }, 500);
  }
});

/**
 * Get user profile
 */
app.get("/make-server-8828d0dd/user/profile", async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    const user = await verifyAuth(authHeader);

    if (!user) {
      return c.json({ error: "Unauthorized - Please login with your credentials" }, 401);
    }

    // Get user data from Supabase
    const { data: userData } = await supabase.auth.admin.getUserById(user.userId);

    // Get additional data from KV store
    const university = await kv.get(`user:${user.userId}:university`);
    const location = await kv.get(`user:${user.userId}:location`);

    return c.json({
      user: {
        id: user.userId,
        email: user.email,
        name: userData?.user?.user_metadata?.name,
        role: userData?.user?.user_metadata?.role,
      },
      university,
      location
    });
  } catch (err: any) {
    console.error("Get profile error:", err);
    return c.json({ error: err.message || "Internal server error" }, 500);
  }
});

/**
 * Save pickup route for a bus
 */
app.post("/make-server-8828d0dd/user/pickup-route", async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    const user = await verifyAuth(authHeader);

    if (!user) {
      return c.json({ error: "Unauthorized - Please login with your credentials" }, 401);
    }

    const { bus_id, pickup_latitude, pickup_longitude } = await c.req.json();

    if (!bus_id || !pickup_latitude || !pickup_longitude) {
      return c.json({ error: "Bus ID and pickup coordinates are required" }, 400);
    }

    // Save to KV store
    await kv.set(`user:${user.userId}:pickup-route`, {
      bus_id,
      pickup_latitude,
      pickup_longitude,
      created_at: new Date().toISOString()
    });

    return c.json({
      success: true,
      message: "Pickup route saved successfully"
    });
  } catch (err: any) {
    console.error("Save pickup route error:", err);
    return c.json({ error: err.message || "Internal server error" }, 500);
  }
});

/**
 * Get user's saved pickup route
 */
app.get("/make-server-8828d0dd/user/pickup-route", async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    const user = await verifyAuth(authHeader);

    if (!user) {
      return c.json({ error: "Unauthorized - Please login with your credentials" }, 401);
    }

    const pickupRoute = await kv.get(`user:${user.userId}:pickup-route`);

    return c.json({
      pickup_route: pickupRoute
    });
  } catch (err: any) {
    console.error("Get pickup route error:", err);
    return c.json({ error: err.message || "Internal server error" }, 500);
  }
});

/**
 * Submit feedback for a driver (Requires Auth)
 */
app.post("/make-server-8828d0dd/feedback", async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    const user = await verifyAuth(authHeader);

    if (!user) {
      return c.json({ error: "Unauthorized - Please login to submit feedback" }, 401);
    }

    const { driver_id, rating, comment } = await c.req.json();

    if (!driver_id || !rating) {
      return c.json({ error: "Driver ID and rating are required" }, 400);
    }

    if (rating < 1 || rating > 5) {
      return c.json({ error: "Rating must be between 1 and 5" }, 400);
    }

    const feedbackId = `feedback:${driver_id}:${Date.now()}:${user.userId}`;
    
    await kv.set(feedbackId, {
      driver_id,
      user_id: user.userId,
      user_email: user.email,
      rating,
      comment: comment || null,
      created_at: new Date().toISOString()
    });

    return c.json({
      success: true,
      message: "Feedback submitted successfully"
    });
  } catch (err: any) {
    console.error("Submit feedback error:", err);
    return c.json({ error: err.message || "Internal server error" }, 500);
  }
});

// ============================================
// PUBLIC ROUTES (No Auth Required)
// ============================================

/**
 * Get all feedback for a driver
 */
app.get("/make-server-8828d0dd/drivers/:driverId/feedback", async (c) => {
  try {
    const driverId = c.req.param('driverId');
    
    // Get all feedback for this driver
    const allFeedback = await kv.getByPrefix(`feedback:${driverId}:`);
    
    return c.json({
      feedback: allFeedback || []
    });
  } catch (err: any) {
    console.error("Get driver feedback error:", err);
    return c.json({ error: err.message || "Internal server error" }, 500);
  }
});

/**
 * Get all universities
 */
app.get("/make-server-8828d0dd/universities", async (c) => {
  try {
    // Return mock data for now (you can replace with KV storage later)
    return c.json({
      universities: [
        // This would come from your database in production
      ]
    });
  } catch (err: any) {
    console.error("Get universities error:", err);
    return c.json({ error: err.message || "Internal server error" }, 500);
  }
});

// Health check endpoint
app.get("/make-server-8828d0dd/health", (c) => {
  return c.json({ status: "ok" });
});

Deno.serve(app.fetch);