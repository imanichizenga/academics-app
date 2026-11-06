from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views as v

router = SimpleRouter()
router.register("contents", v.ContentViewSet, basename="content")
urlpatterns = [
    path("categories/", v.CategoryTreeView.as_view()),
    path("tags/", v.TagListView.as_view()),
    path("home/", v.HomeView.as_view()),
    path("sitemap/", v.SitemapView.as_view()),
    path("continue/", v.ContinueLearningView.as_view()),
    *router.urls,
]
