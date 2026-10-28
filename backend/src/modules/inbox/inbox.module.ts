import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Authenticated } from '../../common/auth/decorators';
import { MarkReadDto, MessagesQuery, OpenChatDto, SendMessageDto } from './inbox.dto';
import { InboxService } from './inbox.service';

// Bildirishnomalar va ichki chat har bir xodimning shaxsiy ma'lumoti: alohida ruxsat emas, faqat login va
// "o'ziniki" tekshiruvi (servisda userId / ishtirokchilik bo'yicha)
@Authenticated()
@Controller()
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get('inbox/counters')
  counters() {
    return this.inbox.counters();
  }

  @Get('notifications')
  notifications() {
    return this.inbox.notifications();
  }

  @Post('notifications/read')
  @HttpCode(204)
  markNotificationsRead(@Body() dto: MarkReadDto) {
    return this.inbox.markNotificationsRead(dto.ids);
  }

  @Get('chats')
  listChats() {
    return this.inbox.listChats();
  }

  @Post('chats')
  @HttpCode(200)
  openChat(@Body() dto: OpenChatDto) {
    return this.inbox.openChat(dto.user_id);
  }

  @Get('chats/:id/messages')
  messages(@Param('id', ParseUUIDPipe) id: string, @Query() query: MessagesQuery) {
    return this.inbox.messages(id, query.before);
  }

  @Post('chats/:id/messages')
  send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto) {
    return this.inbox.send(id, dto.body);
  }

  @Post('chats/:id/read')
  @HttpCode(204)
  markChatRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.inbox.markChatRead(id);
  }
}

@Module({ controllers: [InboxController], providers: [InboxService] })
export class InboxModule {}
