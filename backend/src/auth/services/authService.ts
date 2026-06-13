import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../../common/db/models/User.js';
import { loadEnvConfig } from '../../common/config/envConfig.js';

export type AuthRole = 'user' | 'admin';

export interface AuthRouteResult {
  status: number;
  body: Record<string, unknown>;
}

export function signToken(user: { id: string; email: string; name: string; role: AuthRole }): string {
  const env = loadEnvConfig();
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export async function register(body: any): Promise<AuthRouteResult> {
  try {
    const { name, email, password } = body;
    if (!name || !email || !password) {
      return { status: 400, body: { success: false, error: 'Name, email, and password are required' } };
    }
    if (password.length < 6) {
      return { status: 400, body: { success: false, error: 'Password must be at least 6 characters' } };
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return { status: 409, body: { success: false, error: 'Email already registered' } };
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email: email.toLowerCase(), password: hashed });
    const role = user.role || 'user';
    const token = signToken({
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role,
    });

    return {
      status: 201,
      body: {
        success: true,
        data: {
          token,
          user: { id: user._id.toString(), name: user.name, email: user.email, role },
        },
      },
    };
  } catch (error) {
    return { status: 500, body: { success: false, error: String(error) } };
  }
}

export async function login(body: any): Promise<AuthRouteResult> {
  try {
    const { email, password } = body;
    if (!email || !password) {
      return { status: 400, body: { success: false, error: 'Email and password are required' } };
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return { status: 401, body: { success: false, error: 'Invalid email or password' } };
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return { status: 401, body: { success: false, error: 'Invalid email or password' } };
    }

    const role = user.role || 'user';
    const token = signToken({
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role,
    });

    return {
      status: 200,
      body: {
        success: true,
        data: {
          token,
          user: { id: user._id.toString(), name: user.name, email: user.email, role },
        },
      },
    };
  } catch (error) {
    return { status: 500, body: { success: false, error: String(error) } };
  }
}

export async function getMe(userId: string, jwtRole: string | undefined): Promise<AuthRouteResult> {
  try {
    const doc = await User.findById(userId).select('name email role').lean();
    if (!doc) {
      return { status: 401, body: { success: false, error: 'User not found' } };
    }

    const role = (doc.role as AuthRole) || 'user';
    const data = {
      id: userId,
      email: doc.email,
      name: doc.name,
      role,
    };
    const currentJwtRole = jwtRole || 'user';
    const payload: { success: boolean; data: typeof data; token?: string } = { success: true, data };
    if (role !== currentJwtRole) {
      payload.token = signToken({ id: userId, email: doc.email, name: doc.name, role });
    }

    return { status: 200, body: payload };
  } catch (error) {
    return { status: 500, body: { success: false, error: String(error) } };
  }
}
