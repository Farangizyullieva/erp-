import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class MarkReadDto {
  /** Ko'rsatilmasa — hammasi o'qilgan deb belgilanadi */
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) ids?: string[];
}

export class OpenChatDto {
  @IsUUID() user_id!: string;
}

export class SendMessageDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString() @MinLength(1) @MaxLength(4000) body!: string;
}

export class MessagesQuery {
  /** Shu vaqtdan oldingi xabarlar (yuqoriga varaqlash) */
  @IsOptional() @IsISO8601() before?: string;
}
