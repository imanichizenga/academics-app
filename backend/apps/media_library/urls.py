from django.urls import path, re_path

from . import views as v

urlpatterns = [
    path("<uuid:pk>/download/", v.DownloadView.as_view()),
    path("<uuid:pk>/view/", v.ViewFileView.as_view()),
    path("<uuid:pk>/preview/", v.PreviewView.as_view()),
    path("<uuid:pk>/stream/", v.StreamView.as_view()),
    re_path(r"^hls/(?P<token>[^/]+)/(?P<path>.+)$", v.HlsView.as_view()),
    path("file/<str:token>/", v.SignedFileView.as_view()),
    re_path(r"^public/(?P<key>.+)$", v.PublicFileView.as_view()),
    path("local-part/<str:token>/", v.LocalPartView.as_view()),
]
