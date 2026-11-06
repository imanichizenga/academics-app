from django.urls import path

from . import views as v

urlpatterns = [
    path("contents/<uuid:pk>/comments/", v.ContentCommentsView.as_view()),
    path("contents/<uuid:pk>/like/", v.LikeView.as_view()),
    path("contents/<uuid:pk>/bookmark/", v.BookmarkView.as_view()),
    path("contents/<uuid:pk>/view/", v.ViewCountView.as_view()),
    path("contents/<uuid:pk>/progress/", v.ProgressView.as_view()),
    path("comments/<uuid:pk>/", v.CommentDetailView.as_view()),
    path("comments/<uuid:pk>/like/", v.CommentLikeView.as_view()),
    path("comments/<uuid:pk>/report/", v.CommentReportView.as_view()),
    path("library/bookmarks/", v.MyBookmarksView.as_view()),
    path("library/unlocked/", v.MyUnlockedView.as_view()),
]
