import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.headers['wallet-api-key'];

    if (!apiKey) {
      throw new HttpException('API key is missing', HttpStatus.BAD_REQUEST);
    }

    const validApiKey = this.configService.get('apiKey');

    if (apiKey !== validApiKey) {
      throw new HttpException('Invalid API key', HttpStatus.BAD_REQUEST);
    }

    return true;
  }
}
